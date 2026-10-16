import { limitSnapshot, saveLimits } from "../src/lib/limit-settings";
import { loginIdentifierKey } from "../src/lib/login-identity";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  createWriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import tar from "tar-stream";
import sharp from "sharp";
import { openDatabase, migrate } from "../src/lib/db";
import {
  bootstrapAdmin,
  manageWarden,
  previewCsv,
  importCsv,
} from "../src/lib/admin";
import { passwordHash, login } from "../src/lib/auth";
import {
  uid,
  now,
  createReport,
  addEvent,
  getReport,
  listReports,
  saveLocation,
} from "../src/lib/service";
import { dashboard } from "../src/lib/dashboard";
import { putPhoto, readPhoto } from "../src/lib/storage";
import { makeBackup, validateArchive, stageRestore } from "../src/lib/backup";
import {
  control,
  enterRequest,
  leaveRequest,
  newJob,
  updateJob,
  state,
  setState,
  runtimeStorage,
  type Job,
} from "../src/lib/control";
import { runJob } from "../src/lib/jobs";
import type { User } from "../src/lib/constants";
import { createServer } from "node:http";
import { initialPasswordChange } from "../src/lib/account-policy";
const dir = mkdtempSync(path.join(tmpdir(), "paini-admin-"));
process.env.CONTROL_DIR = path.join(dir, "control");
process.env.DATABASE_PATH = path.join(dir, "paini.db");
process.env.UPLOAD_DIR = path.join(dir, "photos");
delete process.env.S3_BUCKET;
const password = "Temporary-password-123";
const db = openDatabase(process.env.DATABASE_PATH);
migrate(db);
const actor = () =>
  db.prepare("SELECT * FROM users WHERE role='superadmin'").get() as User;
test("versioned role migration preserves legacy report identities, foreign keys and closure triggers", () => {
  const legacy = openDatabase(":memory:");
  legacy.exec(readFileSync("migrations/001_initial.sql", "utf8"));
  legacy.exec(
    "CREATE TABLE migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO migrations VALUES ('001_initial.sql','2026-01-01'); INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES ('old','Legacy','legacy','hash','student','2026-01-01'); INSERT INTO blocks VALUES ('b','Red','RED',0); INSERT INTO levels VALUES ('l','b','Ground','G',0,0); INSERT INTO rooms VALUES ('r','l','G01',0); INSERT INTO reports(id,report_number,creator_id,room_id,title,description,category,status,created_at,updated_at,submission_key) VALUES ('report','RED-G-00001','old','r','Lock','Broken','Locks/doors','Closed','2026-01-01','2026-01-01','key');",
  );
  migrate(legacy);
  assert.equal(
    (
      legacy
        .prepare("SELECT report_number FROM reports WHERE id='report'")
        .get() as { report_number: string }
    ).report_number,
    "RED-G-00001",
  );
  assert.deepEqual(legacy.pragma("foreign_key_check"), []);
  assert.throws(() =>
    legacy.prepare("UPDATE reports SET title='changed'").run(),
  );
  assert.equal(
    (
      legacy.prepare("SELECT role FROM users WHERE id='old'").get() as {
        role: string;
      }
    ).role,
    "student",
  );
  legacy.close();
});
test("bootstrap is idempotent, never promotes roles, and requires password change", async () => {
  const other = openDatabase(":memory:");
  migrate(other);
  other
    .prepare(
      "INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES ('x','Warden','admin','x','warden',?)",
    )
    .run(now());
  await assert.rejects(
    bootstrapAdmin(other, {
      PAINI_SUPERADMIN_USERNAME: "admin",
      PAINI_SUPERADMIN_PASSWORD: password,
    }),
    /another account/,
  );
  other.close();
  assert.equal(
    (
      await bootstrapAdmin(db, {
        PAINI_SUPERADMIN_USERNAME: "admin",
        PAINI_SUPERADMIN_PASSWORD: password,
      })
    ).created,
    true,
  );
  assert.equal(actor().must_change, 1);
  const before = db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(actor().id);
  await bootstrapAdmin(db, {
    PAINI_SUPERADMIN_USERNAME: "admin",
    PAINI_SUPERADMIN_PASSWORD: "different-password-456",
  });
  assert.deepEqual(
    db.prepare("SELECT password_hash FROM users WHERE id=?").get(actor().id),
    before,
  );
  assert.equal((await login(db, "admin", password)).user.role, "superadmin");
  db.prepare("UPDATE users SET must_change=0 WHERE id=?").run(actor().id);
});
test("warden archive revokes sessions, reserves usernames, preserves identity and restores without sessions", async () => {
  const { id } = await manageWarden(db, actor(), undefined, {
    name: "Warden One",
    username: "wardenone",
    password,
  });
  await login(db, "wardenone", password);
  await manageWarden(db, actor(), id, { action: "archive" });
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(id) as {
        n: number;
      }
    ).n,
    0,
  );
  assert.equal(
    (
      db.prepare("SELECT name FROM users WHERE id=?").get(id) as {
        name: string;
      }
    ).name,
    "Warden One",
  );
  await assert.rejects(login(db, "wardenone", password));
  await assert.rejects(
    manageWarden(db, actor(), undefined, {
      name: "Duplicate",
      username: "wardenone",
      password,
    }),
  );
  await manageWarden(db, actor(), id, { action: "restore" });
  await manageWarden(db, actor(), id, {
    action: "reset",
    password: "Reset-password-12345",
  });
  assert.equal(
    (await login(db, "wardenone", "Reset-password-12345")).user.must_change,
    1,
  );
});
test("CSV handles BOM/quotes/contacts, rejects entire invalid files and retries idempotently", async () => {
  const csv =
    '\uFEFFfullname,username,password,phone number,email\r\n"Nur, Aisyah",aisyah,Temporary-password-123,0123456789,aisyah@example.com\r\nAmir,amir,Temporary-password-123,+60123456789,\r\n\r\n';
  const p = previewCsv(db, actor(), csv);
  assert.ok(p.valid);
  assert.ok(!JSON.stringify(p).includes(password));
  assert.equal(p.rows[0].fullname, "Nur, Aisyah");
  const id = uid();
  assert.equal((await importCsv(db, actor(), csv, id)).count, 2);
  assert.equal((await importCsv(db, actor(), csv, id)).count, 2);
  const user = db
    .prepare("SELECT * FROM users WHERE username='aisyah'")
    .get() as User;
  assert.equal(user.student_id, "AISYAH");
  assert.equal(user.phone, "0123456789");
  assert.equal(user.room_id, null);
  assert.equal(user.must_change, 1);
  for (const bad of [
    "fullname,username,password\nGood,newuser,Temporary-password-123\nBad,bad,short",
    "fullname,username,password\nA,dupe,Temporary-password-123\nB,dupe,Temporary-password-123",
    "fullname,username,password,email\nA,goodname,Temporary-password-123,not-email",
    "fullname,username,password\nAdmin,admin,Temporary-password-123",
  ]) {
    assert.equal(previewCsv(db, actor(), bad).valid, false);
    await assert.rejects(importCsv(db, actor(), bad, uid()));
  }
  assert.equal(
    db.prepare("SELECT id FROM users WHERE username='newuser'").get(),
    undefined,
  );
  assert.throws(() =>
    previewCsv(db, actor(), 'fullname,username,password\n"unclosed'),
  );
  const minimal =
    "fullname,username,password\nMinimal,minimal,Temporary-password-123";
  assert.ok(previewCsv(db, actor(), minimal).valid);
  await assert.rejects(
    importCsv(db, { ...actor(), role: "warden" }, minimal, uid()),
    /Superadmin/,
  );
  const collision =
    "fullname,username,password\nConflict,collision,Temporary-password-123";
  db.prepare(
    "UPDATE users SET student_id='COLLISION' WHERE username='amir'",
  ).run();
  assert.equal(previewCsv(db, actor(), collision).valid, false);
  const concurrent =
    "fullname,username,password\nConcurrent,concurrent,Temporary-password-123";
  const results = await Promise.allSettled([
    importCsv(db, actor(), concurrent, uid()),
    importCsv(db, actor(), concurrent, uid()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const audits = JSON.stringify(db.prepare("SELECT * FROM admin_audit").all());
  assert.ok(!audits.includes(password));
});
test("password policy defaults on, controls new/reset accounts and leaves existing requirements unchanged", async () => {
  assert.equal(initialPasswordChange(db), 1);
  const existing = db
    .prepare("SELECT must_change FROM users WHERE username='aisyah'")
    .get();
  db.prepare(
    "UPDATE app_settings SET value=0 WHERE key='require_initial_password_change'",
  ).run();
  const w = await manageWarden(db, actor(), undefined, {
    name: "Policy Warden",
    username: "policywarden",
    password,
  });
  assert.equal(
    (
      db.prepare("SELECT must_change FROM users WHERE id=?").get(w.id) as {
        must_change: number;
      }
    ).must_change,
    0,
  );
  await manageWarden(db, actor(), w.id, {
    action: "reset",
    password: "Reset-policy-password123",
  });
  assert.equal(
    (
      db.prepare("SELECT must_change FROM users WHERE id=?").get(w.id) as {
        must_change: number;
      }
    ).must_change,
    0,
  );
  await importCsv(
    db,
    actor(),
    "fullname,username,password\nPolicy Student,policystudent,Temporary-password-123",
    uid(),
  );
  assert.equal(
    (
      db
        .prepare("SELECT must_change FROM users WHERE username='policystudent'")
        .get() as { must_change: number }
    ).must_change,
    0,
  );
  assert.deepEqual(
    db.prepare("SELECT must_change FROM users WHERE username='aisyah'").get(),
    existing,
  );
  db.prepare(
    "UPDATE app_settings SET value=1 WHERE key='require_initial_password_change'",
  ).run();
  await manageWarden(db, actor(), w.id, {
    action: "reset",
    password: "Reset-policy-password456",
  });
  assert.equal(
    (
      db.prepare("SELECT must_change FROM users WHERE id=?").get(w.id) as {
        must_change: number;
      }
    ).must_change,
    1,
  );
});
test("complete backup restores closed reports/photos, checks schema/integrity and revokes sessions", async () => {
  const identifierKey = loginIdentifierKey();
  db.prepare("UPDATE users SET must_change=0").run();
  const w = db.prepare("SELECT * FROM users WHERE role='warden'").get() as User,
    a = db.prepare("SELECT * FROM users WHERE username='aisyah'").get() as User;
  const b = saveLocation(db, w, "blocks", { name: "Red", code: "RED" }),
    l = saveLocation(db, w, "levels", {
      name: "Ground",
      code: "G",
      parent_id: b.id,
    }),
    r = saveLocation(db, w, "rooms", { name: "G01", parent_id: l.id });
  const photo = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#aa3344" },
    })
      .webp()
      .toBuffer(),
    photoId = uid(),
    key = uid() + ".webp";
  await putPhoto(key, photo);
  db.prepare(
    "INSERT INTO uploads(id,owner_id,object_key,bytes,width,height,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(photoId, a.id, key, photo.length, 20, 20, now());
  const report = createReport(db, a, {
    room_id: r.id,
    title: "Broken lock",
    category: "Locks/doors",
    description: "Please fix",
    photos: [photoId],
    submission_key: uid(),
  });
  addEvent(db, w, report.id, {
    status: "Closed",
    expected_status: "Submitted",
    message: "Replaced lock",
    photos: [],
    submission_key: uid(),
  });
  for (const fn of [
    () => getReport(db, actor(), report.id),
    () => listReports(db, actor(), new URLSearchParams()),
    () => dashboard(db, actor(), new URLSearchParams()),
  ])
    assert.throws(fn, /Maintenance access/);
  const limitsBefore = limitSnapshot(db);
  const savedLimits = saveLimits(db, actor(), { revision: limitsBefore.revision, values: { ...limitsBefore.values, PHOTO_EXPIRY_HOURS: 48 } });
  const backup = await makeBackup(uid());
  assert.ok(
    backup.manifest.files.every(
      (f) => f.name === "database.sqlite" || f.name.startsWith("photos/"),
    ),
  );
  assert.equal(backup.manifest.files.length, 2);
  const validated = await validateArchive(uid(), backup.archive),
    staged = await stageRestore(validated.directory),
    restored = openDatabase(staged.database);
  assert.equal(
    (restored.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number })
      .n,
    0,
  );
  assert.equal(
    (
      restored.prepare("SELECT COUNT(*) n FROM login_limits").get() as {
        n: number;
      }
    ).n,
    0,
  );
  assert.ok(identifierKey.equals(loginIdentifierKey()));
  assert.deepEqual(limitSnapshot(restored).values, savedLimits.values);
  assert.equal(getReport(restored, w, report.id).report_number, "RED-G-00001");
  assert.throws(() =>
    restored
      .prepare("UPDATE reports SET status='Submitted' WHERE id=?")
      .run(report.id),
  );
  assert.equal((restored.pragma("foreign_key_check") as unknown[]).length, 0);
  assert.deepEqual(await readPhoto(key, staged), photo);
  restored.close();
  // Simulate failed restart after activation: previous namespace must be restored.
  const validation = newJob(actor().id, "validate");
  updateJob(validation.id, "ready", 100, validated);
  const restore = newJob(actor().id, "restore", {
    validationId: validation.id,
  });
  let starts = 0,
    stops = 0;
  const previous = runtimeStorage();
  await runJob(
    control().prepare("SELECT * FROM jobs WHERE id=?").get(restore.id) as Job,
    {
      stop: async () => {
        stops++;
        assert.equal(enterRequest(), null);
      },
      start: async () => {
        if (++starts === 1) throw new Error("simulated startup failure");
      },
    },
  );
  assert.equal(starts, 2);
  assert.equal(stops, 2);
  assert.deepEqual(runtimeStorage(), previous);
  assert.ok(identifierKey.equals(loginIdentifierKey()));
  assert.equal(state("maintenance", true), false);
  assert.equal(
    (
      control()
        .prepare("SELECT status FROM jobs WHERE id=?")
        .get(restore.id) as { status: string }
    ).status,
    "failed",
  );
  assert.ok(
    (
      control()
        .prepare("SELECT details FROM audit WHERE action='restore.recovery'")
        .get() as { details: string }
    ).details.includes("backup.tar.gz"),
  );
  const request = enterRequest();
  assert.ok(request);
  leaveRequest(request);
});
test("archive traversal and corrupt gzip are rejected", async () => {
  const file = path.join(dir, "unsafe.tar.gz"),
    pack = tar.pack();
  const writing = pipeline(pack, createGzip(), createWriteStream(file));
  pack.entry({ name: "../escape", size: 1 }, "x");
  pack.finalize();
  await writing;
  await assert.rejects(validateArchive(uid(), file), /Unsafe/);
  assert.equal(existsSync(path.join(dir, "escape")), false);
  await assert.rejects(validateArchive(uid(), process.env.DATABASE_PATH!));
});
test("S3-compatible backup and staging use isolated object namespaces and fail missing photos", async () => {
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const key = new URL(req.url!, "http://localhost").pathname;
    if (req.method === "PUT") {
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(Buffer.from(part));
      objects.set(key, Buffer.concat(parts));
      res.end();
    } else if (req.method === "GET" && objects.has(key)) {
      res.setHeader("Content-Type", "image/webp");
      res.end(objects.get(key));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { ...process.env };
  process.env.S3_BUCKET = "testbucket";
  process.env.S3_ENDPOINT = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.AWS_ACCESS_KEY_ID = "testing";
  process.env.AWS_SECRET_ACCESS_KEY = "testing";
  process.env.AWS_REQUEST_CHECKSUM_CALCULATION = "WHEN_REQUIRED";
  try {
    const key = (
      db.prepare("SELECT object_key FROM uploads LIMIT 1").get() as {
        object_key: string;
      }
    ).object_key;
    const bytes = readFileSync(path.join(process.env.UPLOAD_DIR!, key));
    await putPhoto(key, bytes);
    const backup = await makeBackup(uid()),
      validated = await validateArchive(uid(), backup.archive),
      staged = await stageRestore(validated.directory);
    assert.ok(staged.prefix.startsWith("restored/"));
    assert.deepEqual(await readPhoto(key, staged), bytes);
    assert.ok(objects.has("/testbucket/" + key));
    objects.delete("/testbucket/" + key);
    await assert.rejects(makeBackup(uid()));
  } finally {
    for (const k of [
      "S3_BUCKET",
      "S3_ENDPOINT",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_REQUEST_CHECKSUM_CALCULATION",
    ]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
