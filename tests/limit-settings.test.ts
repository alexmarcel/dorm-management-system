import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, migrate } from "../src/lib/db";
import {
  limitSnapshot,
  saveLimits,
  configuredLimit,
  photoPolicy,
  uploadExpirySql,
} from "../src/lib/limit-settings";
import { consume, uploadQuota } from "../src/lib/quotas";
import { settingsApi } from "../src/lib/settings-api";
import { NextRequest } from "next/server";
import { createReport, saveLocation, uid, now } from "../src/lib/service";
import { validatePhoto } from "../src/lib/storage";
import { passwordWork } from "../src/lib/password-work";
import { login } from "../src/lib/auth";
import type { User } from "../src/lib/constants";
import argon2 from "argon2";
import sharp from "sharp";
function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  const user = (role: string) => {
    db.prepare(
      "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES (?,?,?,?,?,0,?)",
    ).run(role, role, role, "unused", role, now());
    return db.prepare("SELECT * FROM users WHERE id=?").get(role) as User;
  };
  return {
    db,
    admin: user("superadmin"),
    student: user("student"),
    warden: user("warden"),
  };
}
const status = (n: number) => (e: unknown) =>
  (e as { status: number }).status === n;
function update(
  f: ReturnType<typeof fixture>,
  changes: Record<string, number>,
) {
  const before = limitSnapshot(f.db);
  return saveLimits(f.db, f.admin, {
    revision: before.revision,
    values: { ...before.values, ...changes },
  });
}

test("superadmin limit changes are validated, atomic, audited and reject stale edits", async () => {
  const f = fixture();
  try {
    const initial = limitSnapshot(f.db);
    assert.throws(() => saveLimits(f.db, f.student, null), status(403));
    assert.throws(() => saveLimits(f.db, f.warden, null), status(403));
    for (const values of [
      { ...initial.values, LOGIN_GLOBAL_LIMIT: 0 },
      { ...initial.values, PHOTO_MAX_BYTES: 500001 },
      { ...initial.values, PHOTO_MAX_ATTACHMENTS: 6 },
      { ...initial.values, LOGIN_CONCURRENCY: 2.5 },
      { ...initial.values, extra: 1 },
      {},
    ]) {
      assert.throws(
        () => saveLimits(f.db, f.admin, { revision: initial.revision, values }),
        status(400),
      );
      assert.equal(limitSnapshot(f.db).revision, initial.revision);
    }
    const saved = update(f, {
      LOGIN_GLOBAL_LIMIT: 121,
      QUOTA_STUDENT_REPORTS: 2,
    });
    assert.equal(configuredLimit(f.db, "LOGIN_GLOBAL_LIMIT"), 121);
    assert.throws(() => saveLimits(f.db, f.admin, initial), status(400));
    assert.throws(
      () =>
        saveLimits(f.db, f.admin, {
          revision: initial.revision,
          values: initial.values,
        }),
      status(409),
    );
    const audit = f.db
      .prepare("SELECT action,details FROM admin_audit")
      .get() as { action: string; details: string };
    assert.equal(audit.action, "settings.limits");
    assert.equal(JSON.parse(audit.details).after.LOGIN_GLOBAL_LIMIT, 121);
    const response = await settingsApi(
      new NextRequest("http://localhost/api/settings/limits"),
      f.db,
      f.admin,
      ["settings", "limits"],
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).revision, saved.revision);
    for (const actor of [f.student, f.warden])
      await assert.rejects(
        settingsApi(
          new NextRequest("http://localhost/api/settings/limits", {
            method: "POST",
            body: "invalid json",
          }),
          f.db,
          actor,
          ["settings", "limits"],
        ),
        status(403),
      );
    f.db.prepare("UPDATE users SET active=0 WHERE id=?").run(f.admin.id);
    assert.throws(
      () =>
        saveLimits(f.db, f.admin, {
          revision: saved.revision,
          values: saved.values,
        }),
      status(403),
    );
  } finally {
    f.db.close();
  }
});

test("saved quotas take precedence over environment defaults and preserve current usage/windows", () => {
  const f = fixture(),
    savedEnv = process.env.QUOTA_STUDENT_REPORTS;
  process.env.QUOTA_STUDENT_REPORTS = "9";
  try {
    assert.equal(configuredLimit(f.db, "QUOTA_STUDENT_REPORTS"), 9);
    f.db.transaction(() => consume(f.db, f.student, "reports")).immediate();
    const before = f.db.prepare("SELECT * FROM usage_limits").get();
    update(f, { QUOTA_STUDENT_REPORTS: 1, QUOTA_DAILY_WINDOW_HOURS: 2 });
    process.env.QUOTA_STUDENT_REPORTS = "15";
    assert.equal(configuredLimit(f.db, "QUOTA_STUDENT_REPORTS"), 1);
    assert.throws(
      () =>
        f.db.transaction(() => consume(f.db, f.student, "reports")).immediate(),
      status(429),
    );
    assert.deepEqual(f.db.prepare("SELECT * FROM usage_limits").get(), before);
    update(f, { QUOTA_STUDENT_REPORTS: 2 });
    f.db.transaction(() => consume(f.db, f.student, "reports")).immediate();
    f.db.prepare("UPDATE usage_limits SET reset_at=0").run();
    const start = Date.now();
    f.db.transaction(() => consume(f.db, f.student, "reports")).immediate();
    const row = f.db
      .prepare("SELECT reset_at,used FROM usage_limits")
      .get() as { reset_at: number; used: number };
    assert.equal(row.used, 1);
    assert.ok(
      row.reset_at >= start + 2 * 3600000 &&
        row.reset_at <= Date.now() + 2 * 3600000,
    );
  } finally {
    if (savedEnv === undefined) delete process.env.QUOTA_STUDENT_REPORTS;
    else process.env.QUOTA_STUDENT_REPORTS = savedEnv;
    f.db.close();
  }
});

test("saved login and concurrency limits are enforced immediately", async () => {
  const f = fixture(),
    verify = argon2.verify;
  argon2.verify = async () => false;
  try {
    update(f, { LOGIN_GLOBAL_LIMIT: 1, LOGIN_CONCURRENCY: 1 });
    await assert.rejects(login(f.db, "missing", "bad", "one"), status(401));
    await assert.rejects(login(f.db, "missing", "bad", "two"), status(429));
    update(f, { LOGIN_GLOBAL_LIMIT: 2 });
    await assert.rejects(login(f.db, "missing", "bad", "two"), status(401));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = passwordWork(f.db, () => gate);
    await assert.rejects(
      passwordWork(f.db, async () => true),
      status(429),
    );
    update(f, { LOGIN_CONCURRENCY: 2 });
    assert.equal(await passwordWork(f.db, async () => true), true);
    release();
    await held;
  } finally {
    argon2.verify = verify;
    f.db.close();
  }
});

test("photo settings enforce image dimensions, pending counts and attachment counts", async () => {
  const f = fixture();
  try {
    update(f, {
      PHOTO_MAX_DIMENSION: 16,
      PHOTO_MAX_ATTACHMENTS: 1,
      PHOTO_MAX_PENDING: 1,
    });
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "red" },
    })
      .webp()
      .toBuffer();
    await assert.rejects(validatePhoto(image, photoPolicy(f.db)), status(400));
    const one = uid(),
      two = uid();
    const put = (id: string) =>
      f.db
        .prepare("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)")
        .run(id, f.student.id, id + ".webp", 100, 10, 10, now());
    put(one);
    assert.throws(
      () =>
        f.db.transaction(() => uploadQuota(f.db, f.student, 100)).immediate(),
      status(429),
    );
    put(two);
    const block = saveLocation(f.db, f.warden, "blocks", {
      name: "B",
      code: "B",
    }).id;
    const level = saveLocation(f.db, f.warden, "levels", {
      name: "L",
      code: "L",
      parent_id: block,
    }).id;
    const room = saveLocation(f.db, f.warden, "rooms", {
      name: "1",
      parent_id: level,
    }).id;
    const draft = {
      room_id: room,
      title: "Repair",
      description: "Please fix",
      category: "Locks/doors",
      submission_key: uid(),
      photos: [one, two],
    };
    assert.throws(() => createReport(f.db, f.student, draft), status(400));
    assert.equal(
      (f.db.prepare("SELECT COUNT(*) n FROM reports").get() as { n: number }).n,
      0,
    );
    assert.equal(
      (
        f.db.prepare("SELECT COUNT(*) n FROM usage_limits").get() as {
          n: number;
        }
      ).n,
      0,
    );
    f.db
      .prepare("INSERT INTO upload_expirations VALUES (?,?)")
      .run(one, new Date(Date.now() - 1).toISOString());
    update(f, { PHOTO_EXPIRY_HOURS: 48 });
    assert.throws(
      () => createReport(f.db, f.student, { ...draft, photos: [one] }),
      status(400),
    );
    const expired = f.db
      .prepare(
        `SELECT u.id FROM uploads u LEFT JOIN upload_expirations x ON x.upload_id=u.id WHERE ${uploadExpirySql}<?`,
      )
      .all(now()) as { id: string }[];
    assert.deepEqual(
      expired.map((r) => r.id),
      [one],
    );
    createReport(f.db, f.student, { ...draft, photos: [two] });
  } finally {
    f.db.close();
  }
});

test("saved limits persist across database reopen and concurrent saves cannot overwrite silently", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path");
  const { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util");
  const f = fixture(),
    dir = mkdtempSync(path.join(tmpdir(), "paini-limits-")),
    file = path.join(dir, "test.db");
  try {
    const snapshot = update(f, { LOGIN_GLOBAL_LIMIT: 101 });
    await f.db.backup(file);
    const results = await Promise.all(
      [102, 103].map((value) =>
        promisify(execFile)(process.execPath, [
          "--import",
          "tsx",
          "tests/helpers/save-limits.ts",
          file,
          snapshot.revision,
          String(value),
        ]),
      ),
    );
    assert.deepEqual(results.map((r) => r.stdout).sort(), ["200", "409"]);
    const db = openDatabase(file);
    try {
      assert.ok([102, 103].includes(configuredLimit(db, "LOGIN_GLOBAL_LIMIT")));
      assert.equal(
        (
          db
            .prepare(
              "SELECT COUNT(*) n FROM admin_audit WHERE action='settings.limits'",
            )
            .get() as { n: number }
        ).n,
        2,
      );
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
