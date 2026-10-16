import { limitSnapshot, saveLimits } from "./limit-settings";
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { z } from "zod";
import type { DB } from "./db";
import type { User } from "./constants";
import {
  superadmin,
  listWardens,
  manageWarden,
  previewCsv,
  importCsv,
  verifyAdminPassword,
  audit,
} from "./admin";
import {
  control,
  workerAvailable,
  newJob,
  updateJob,
  maxArchiveBytes,
  operationalAudit,
  type Job,
} from "./control";
import { jobDirectory } from "./backup";
import { assert, AppError, activeActor } from "./service";
import { initialPasswordChange } from "./account-policy";
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function data(req: NextRequest, max = 3 * 1024 * 1024) {
  const r = req.body?.getReader();
  assert(r, 400, "Request body required.");
  let size = 0;
  const buffers: Uint8Array[] = [];
  while (true) {
    const n = await r.read();
    if (n.done) break;
    size += n.value.length;
    if (size > max) {
      await r.cancel();
      throw new AppError(413, "Request is too large.");
    }
    buffers.push(n.value);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid request.");
  }
}
export async function settingsApi(
  req: NextRequest,
  db: DB,
  actor: User,
  parts: string[],
) {
  superadmin(actor);
  const method = req.method,
    route = parts.join("/");
  if (route === "settings" && method === "GET") {
    const counts = db
      .prepare(
        "SELECT role,COUNT(*) count FROM users WHERE active=1 AND archived_at IS NULL GROUP BY role",
      )
      .all();
    return json({
      counts,
      worker: workerAvailable(),
      maxArchiveBytes: maxArchiveBytes(),
      requireInitialPasswordChange: !!initialPasswordChange(db),
    });
  }
  if (route === "settings/limits" && method === "GET") return json(limitSnapshot(db));
  if (route === "settings/limits" && method === "POST") return json(saveLimits(db, actor, await data(req, 32768)));
  if (route === "settings/wardens" && method === "GET")
    return json(listWardens(db, actor, req.nextUrl.searchParams));
  if (route === "settings/security" && method === "POST") {
    const d = z
      .object({ requireInitialPasswordChange: z.boolean() })
      .parse(await data(req));
    db.transaction(() => {
      superadmin(activeActor(db, actor));
      db.prepare(
        "UPDATE app_settings SET value=? WHERE key='require_initial_password_change'",
      ).run(+d.requireInitialPasswordChange);
      audit(db, actor, "settings.password_policy", null, {
        requireInitialPasswordChange: d.requireInitialPasswordChange,
      });
    }).immediate();
    return json({
      requireInitialPasswordChange: d.requireInitialPasswordChange,
    });
  }
  if (parts[1] === "wardens" && parts.length <= 3 && method === "POST")
    return json(await manageWarden(db, actor, parts[2], await data(req)));
  if (route === "settings/import/template" && method === "GET")
    return new NextResponse(
      "fullname,username,password,phone number,email\r\n",
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="paini-students.csv"',
          "Cache-Control": "no-store",
        },
      },
    );
  if (route === "settings/import/preview" && method === "POST") {
    const d = z.object({ csv: z.string() }).parse(await data(req));
    return json(previewCsv(db, actor, d.csv));
  }
  if (route === "settings/import/commit" && method === "POST") {
    const d = z
      .object({ csv: z.string(), operationId: z.uuid() })
      .parse(await data(req));
    return json(await importCsv(db, actor, d.csv, d.operationId));
  }
  if (route === "settings/jobs" && method === "GET") {
    const jobs = control()
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50")
      .all() as Job[];
    return json(
      jobs.map((j) => {
        const result = j.result ? JSON.parse(j.result) : null;
        return {
          id: j.id,
          kind: j.kind,
          status: j.status,
          created_at: j.created_at,
          updated_at: j.updated_at,
          progress: j.progress,
          error: j.error,
          result: result
            ? {
                manifest: result.manifest,
                bytes: result.bytes,
                restored_at: result.restored_at,
              }
            : null,
        };
      }),
    );
  }
  if (route === "settings/backup" && method === "POST") {
    assert(
      workerAvailable(),
      503,
      "Maintenance worker is offline. Start the supervised server.",
    );
    return json(newJob(actor.id, "backup"), 202);
  }
  if (
    parts[1] === "backups" &&
    parts.length === 4 &&
    parts[3] === "download" &&
    method === "GET"
  ) {
    z.uuid().parse(parts[2]);
    const job = control()
      .prepare(
        "SELECT * FROM jobs WHERE id=? AND kind='backup' AND status='complete'",
      )
      .get(parts[2]) as Job | undefined;
    assert(job, 404, "Backup is not ready.");
    const result = JSON.parse(job.result!);
    audit(db, actor, "backup.download", job.id);
    operationalAudit(actor.id, "backup.download", { job: job.id });
    return new NextResponse(
      Readable.toWeb(createReadStream(result.archive)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="paini-${job.id}.tar.gz"`,
          "Content-Length": String(result.bytes),
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  if (route === "settings/restore/upload" && method === "POST") {
    assert(
      workerAvailable(),
      503,
      "Maintenance worker is offline. Start the supervised server.",
    );
    assert(req.body, 400, "Request body required.");
    const job = newJob(actor.id, "validate");
    updateJob(job.id, "uploading", 0);
    await mkdir(jobDirectory(job.id), { recursive: true });
    let size = 0;
    try {
      await pipeline(
        Readable.fromWeb(req.body as never),
        new Transform({
          transform(chunk, _, cb) {
            size += chunk.length;
            if (size > maxArchiveBytes())
              cb(new Error("Backup archive is too large."));
            else cb(null, chunk);
          },
        }),
        createWriteStream(path.join(jobDirectory(job.id), "upload.tar.gz"), {
          flags: "wx",
        }),
      );
      updateJob(job.id, "queued", 0);
      return json(job, 202);
    } catch {
      updateJob(job.id, "failed", 0, null, "Backup upload failed.");
      throw new AppError(400, "Backup upload failed.");
    }
  }
  if (route === "settings/restore/confirm" && method === "POST") {
    assert(
      workerAvailable(),
      503,
      "Maintenance worker is offline. Start the supervised server.",
    );
    const d = z
      .object({
        validationId: z.uuid(),
        password: z.string().min(1).max(128),
        confirm: z.literal(true),
      })
      .parse(await data(req));
    await verifyAdminPassword(db, actor, d.password);
    const valid = control()
      .prepare(
        "SELECT id FROM jobs WHERE id=? AND kind='validate' AND status='ready'",
      )
      .get(d.validationId);
    assert(valid, 400, "Validate a backup before restoring.");
    return control()
      .transaction(() => {
        assert(
          !control()
            .prepare(
              "SELECT id FROM jobs WHERE kind='restore' AND status IN ('queued','running')",
            )
            .get(),
          409,
          "A restore is already running.",
        );
        return json(
          newJob(actor.id, "restore", { validationId: d.validationId }),
          202,
        );
      })
      .immediate();
  }
  assert(false, 404, "Not found.");
}
