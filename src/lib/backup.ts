import Database from "better-sqlite3";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, copyFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import tar from "tar-stream";
import { z } from "zod";
import { openDatabase, migrate } from "./db";
import { readPhoto, putPhoto } from "./storage";
import {
  controlDir,
  runtimeStorage,
  updateJob,
  maxArchiveBytes,
  type RuntimeStorage,
} from "./control";
import { assert } from "./service";

const fileInfo = z.object({
  name: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.object({
  format: z.literal("PAINI-1"),
  created_at: z.iso.datetime(),
  schema: z.array(z.string()),
  records: z.record(z.string(), z.number()),
  files: z.array(fileInfo).max(100000),
});
export type Manifest = z.infer<typeof manifestSchema>;
const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function fileHash(filename: string) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(filename)) hash.update(part);
  return hash.digest("hex");
}
export function jobDirectory(id: string) {
  z.uuid().parse(id);
  return path.join(controlDir(), "jobs", id);
}
function schema(db: Database.Database) {
  return db
    .prepare("SELECT name FROM migrations ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
}
function shape(db: Database.Database) {
  return db
    .prepare(
      "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name",
    )
    .all();
}
export async function makeBackup(
  id: string,
  storage: RuntimeStorage = runtimeStorage(),
): Promise<{ archive: string; manifest: Manifest; bytes: number }> {
  const dir = jobDirectory(id);
  await mkdir(dir, { recursive: true });
  const database = path.join(dir, "database.sqlite");
  const live = openDatabase(storage.database);
  try {
    await live.backup(database);
  } finally {
    live.close();
  }
  const snapshot = openDatabase(database);
  let keys: { object_key: string }[],
    versions: string[],
    records: Record<string, number>;
  try {
    snapshot.prepare("DELETE FROM sessions").run();
    snapshot.prepare("DELETE FROM login_limits").run();
    snapshot
      .prepare(
        "DELETE FROM uploads WHERE id NOT IN (SELECT id FROM attachments)",
      )
      .run();
    keys = snapshot
      .prepare(
        "SELECT u.object_key FROM uploads u JOIN attachments a ON a.id=u.id ORDER BY u.object_key",
      )
      .all() as { object_key: string }[];
    versions = schema(snapshot);
    records = Object.fromEntries(
      ["users", "reports", "events", "attachments"].map((t) => [
        t,
        (snapshot.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number })
          .n,
      ]),
    );
    snapshot.pragma("wal_checkpoint(TRUNCATE)");
    snapshot.pragma("journal_mode=DELETE");
  } finally {
    snapshot.close();
  }
  const files: Manifest["files"] = [
    {
      name: "database.sqlite",
      bytes: (await stat(database)).size,
      sha256: await fileHash(database),
    },
  ];
  await mkdir(path.join(dir, "photos"), { recursive: true });
  for (let i = 0; i < keys.length; i++) {
    const bytes = await readPhoto(keys[i].object_key, storage);
    const target = path.join(dir, "photos", keys[i].object_key);
    await pipeline(
      BufferStream(bytes),
      createWriteStream(target, { flags: "wx" }),
    );
    files.push({
      name: "photos/" + keys[i].object_key,
      bytes: bytes.length,
      sha256: checksum(bytes),
    });
    updateJob(
      id,
      "running",
      Math.round(10 + ((i + 1) / Math.max(keys.length, 1)) * 65),
    );
  }
  const manifest: Manifest = {
    format: "PAINI-1",
    created_at: new Date().toISOString(),
    schema: versions,
    records,
    files,
  };
  const archive = path.join(dir, "backup.tar.gz"),
    pack = tar.pack();
  const pumping = pipeline(
    pack,
    createGzip(),
    createWriteStream(archive, { flags: "wx" }),
  );
  try {
    const content = Buffer.from(JSON.stringify(manifest));
    await new Promise<void>((resolve, reject) =>
      pack.entry(
        { name: "manifest.json", size: content.length, mode: 0o600 },
        content,
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    for (const f of files) {
      const stream = pack.entry({ name: f.name, size: f.bytes, mode: 0o600 });
      await pipeline(createReadStream(path.join(dir, f.name)), stream);
    }
    pack.finalize();
    await pumping;
  } catch (e) {
    pack.destroy(e as Error);
    await pumping.catch(() => {});
    throw e;
  }
  return { archive, manifest, bytes: (await stat(archive)).size };
}
import { Readable } from "node:stream";
const BufferStream = (b: Buffer) => Readable.from([b]);
export async function validateArchive(
  id: string,
  archive: string,
): Promise<{ manifest: Manifest; directory: string }> {
  const dir = path.join(jobDirectory(id), "validated");
  await mkdir(dir, { recursive: true });
  const extract = tar.extract(),
    seen = new Set<string>();
  let total = 0,
    entries = 0;
  const extracting = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      void (async () => {
        assert(
          header.type === "file" &&
            (/^(manifest\.json|database\.sqlite)$/.test(header.name) ||
              /^photos\/[a-f0-9-]{36}\.webp$/.test(header.name)),
          400,
          "Unsafe or unexpected backup entry.",
        );
        assert(!seen.has(header.name), 400, "Duplicate backup entry.");
        seen.add(header.name);
        entries++;
        total += header.size || 0;
        assert(
          entries <= 100002 && total <= maxArchiveBytes() * 4,
          413,
          "Expanded backup is too large.",
        );
        if (header.name === "manifest.json")
          assert(
            (header.size || 0) <= 16 * 1024 * 1024,
            413,
            "Backup manifest is too large.",
          );
        if (header.name.startsWith("photos/"))
          assert(
            (header.size || 0) <= 500000,
            400,
            "Backup photo is too large.",
          );
        const target = path.join(dir, header.name);
        await mkdir(path.dirname(target), { recursive: true });
        await pipeline(stream, createWriteStream(target, { flags: "wx" }));
        next();
      })().catch((e) => {
        stream.destroy();
        extract.destroy(e);
        reject(e);
      });
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });
  const unpacking = pipeline(
    createReadStream(archive),
    createGunzip(),
    extract,
  );
  await Promise.all([extracting, unpacking]);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")),
  );
  assert(
    seen.size === manifest.files.length + 1,
    400,
    "Backup file list does not match its manifest.",
  );
  const declared = new Set<string>();
  for (const f of manifest.files) {
    assert(
      !declared.has(f.name) && seen.has(f.name) && f.name !== "manifest.json",
      400,
      "Backup manifest is invalid.",
    );
    declared.add(f.name);
    const target = path.join(dir, f.name);
    assert(
      (await stat(target)).size === f.bytes &&
        (await fileHash(target)) === f.sha256,
      400,
      "Backup checksum does not match.",
    );
  }
  assert(declared.has("database.sqlite"), 400, "Backup database is missing.");
  const db = new Database(path.join(dir, "database.sqlite"), {
    readonly: true,
  });
  const expected = openDatabase(":memory:");
  migrate(expected);
  try {
    assert(
      JSON.stringify(schema(db)) === JSON.stringify(schema(expected)) &&
        JSON.stringify(manifest.schema) === JSON.stringify(schema(expected)),
      400,
      "Backup schema version is not supported.",
    );
    assert(
      JSON.stringify(shape(db)) === JSON.stringify(shape(expected)),
      400,
      "Backup database schema is not trusted.",
    );
    assert(
      db.pragma("integrity_check", { simple: true }) === "ok" &&
        !(db.pragma("foreign_key_check") as unknown[]).length,
      400,
      "Backup database integrity check failed.",
    );
    const keys = db
      .prepare(
        "SELECT u.object_key,u.bytes,u.width,u.height FROM uploads u JOIN attachments a ON a.id=u.id",
      )
      .all() as {
      object_key: string;
      bytes: number;
      width: number;
      height: number;
    }[];
    assert(
      keys.length === manifest.files.length - 1,
      400,
      "Backup attachments are incomplete.",
    );
    for (const k of keys) {
      assert(
        declared.has("photos/" + k.object_key),
        400,
        "Backup photo is missing.",
      );
      const photo = await readFile(path.join(dir, "photos", k.object_key));
      const metadata = await (await import("sharp")).default(photo).metadata();
      assert(
        metadata.format === "webp" &&
          metadata.width === k.width &&
          metadata.height === k.height &&
          photo.length === k.bytes &&
          k.bytes <= 500000 &&
          k.width <= 1600 &&
          k.height <= 1600,
        400,
        "Backup photo metadata is invalid.",
      );
    }
    for (const name of ["users", "reports", "events", "attachments"])
      assert(
        manifest.records[name] ===
          (db.prepare(`SELECT COUNT(*) n FROM ${name}`).get() as { n: number })
            .n,
        400,
        "Backup record counts do not match.",
      );
    assert(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM users WHERE role='superadmin' AND active=1 AND archived_at IS NULL",
          )
          .get() as { n: number }
      ).n === 1,
      400,
      "Backup must contain an active superadmin.",
    );
  } finally {
    db.close();
    expected.close();
  }
  return { manifest, directory: dir };
}
export async function stageRestore(source: string): Promise<RuntimeStorage> {
  const generation = randomUUID(),
    base = path.join(controlDir(), "generations", generation);
  await mkdir(base, { recursive: true });
  const storage = {
    database: path.join(base, "paini.db"),
    photos: path.join(base, "photos"),
    prefix: `restored/${generation}/`,
  };
  await copyFile(path.join(source, "database.sqlite"), storage.database);
  const db = openDatabase(storage.database);
  try {
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM login_limits").run();
    const keys = db
      .prepare(
        "SELECT u.object_key FROM uploads u JOIN attachments a ON a.id=u.id",
      )
      .all() as { object_key: string }[];
    for (const k of keys)
      await putPhoto(
        k.object_key,
        await readFile(path.join(source, "photos", k.object_key)),
        storage,
      );
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return storage;
}
