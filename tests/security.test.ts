import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { openDatabase, migrate } from "../src/lib/db";
import { login, tokenHash } from "../src/lib/auth";
import { securityConfig } from "../src/lib/security-config";
import { loginSource, UNKNOWN_SOURCE } from "../src/lib/login-source";
import { loginIdentifierKey } from "../src/lib/login-identity";
import { consume, uploadQuota, quotaLimit } from "../src/lib/quotas";
import {
  createReport,
  addEvent,
  uid,
  now,
  saveLocation,
} from "../src/lib/service";
import type { User } from "../src/lib/constants";
import { proxy } from "../src/proxy";
import { NextRequest } from "next/server";
import config from "../next.config";

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  const user = (name: string, role = "student") => {
    db.prepare(
      "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES (?,?,?,?,?,0,?)",
    ).run(name, name, name, "stored-hash", role, now());
    return db.prepare("SELECT * FROM users WHERE id=?").get(name) as User;
  };
  return { db, a: user("alice"), b: user("bob"), w: user("warden", "warden") };
}
const status = (n: number) => (e: unknown) =>
  (e as { status: number }).status === n;
const production = {
  NODE_ENV: "production" as const,
  APP_ORIGIN: "https://paini.example.invalid",
};

test("production requires only a valid HTTPS origin; legacy proxy variables are ignored", () => {
  for (const APP_ORIGIN of [
    undefined,
    "http://paini.example.invalid",
    "broken",
    "https://a:b@host",
    "https://host/",
    "https://host/path",
    "https://host?x",
    "https://host#x",
    "https://*.host",
  ])
    assert.throws(() => securityConfig({ ...production, APP_ORIGIN }));
  assert.equal(securityConfig(production).origin, production.APP_ORIGIN);
  assert.equal(
    securityConfig({
      ...production,
      TRUSTED_PROXY_MODE: "obsolete",
      PROXY_SHARED_SECRET: "invalid",
      LOGIN_IDENTIFIER_KEY: "invalid",
    }).origin,
    production.APP_ORIGIN,
  );
  assert.throws(() =>
    securityConfig({ ...production, LOGIN_GLOBAL_LIMIT: "0" }),
  );
  assert.equal(
    securityConfig({ NODE_ENV: "development" }).origin,
    "http://localhost:3000",
  );
});

test("forwarding addresses are validated best-effort hints; secrets are not required", () => {
  const key = Buffer.alloc(32, 7);
  const identify = (headers: Record<string, string>) =>
    loginSource(new Headers(headers), key);
  const source = identify({ "x-real-ip": "192.0.2.1" });
  assert.match(source, /^[a-f0-9]{64}$/);
  assert.equal(
    identify({
      "x-real-ip": "192.0.2.1",
      "x-forwarded-for": "198.51.100.1",
      "x-paini-proxy-secret": "wrong",
    }),
    source,
  );
  assert.equal(
    identify({
      "x-real-ip": "invalid",
      "x-forwarded-for": "garbage, 192.0.2.1, invalid",
    }),
    source,
  );
  assert.equal(
    identify({ "x-forwarded-for": "198.51.100.1, 192.0.2.1" }),
    source,
  );
  assert.notEqual(identify({ "x-real-ip": "192.0.2.2" }), source); // A hint can be forged.
  assert.equal(
    identify({ "x-real-ip": "2001:0db8:0:0:0:0:0:1" }),
    identify({ "x-real-ip": "2001:db8::1" }),
  );
  for (const value of [
    "",
    "not-an-ip",
    "192.0.2.1:443",
    "[::1]",
    "192.0.2.1, 192.0.2.2",
    "fe80::1%eth0",
  ])
    assert.equal(identify({ "x-real-ip": value }), UNKNOWN_SOURCE);
  assert.equal(
    identify({ "x-forwarded-for": "invalid, unknown" }),
    UNKNOWN_SOURCE,
  );
  assert.equal(identify({}), UNKNOWN_SOURCE);
});

test("login has one shared dummy initialization, one verify, source/account isolation, and bounded work", async () => {
  const f = fixture(),
    hash = argon2.hash,
    verify = argon2.verify;
  let hashes = 0,
    verifies = 0,
    active = 0,
    peak = 0;
  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  argon2.hash = (async () => {
    hashes++;
    return "dummy-hash";
  }) as unknown as typeof argon2.hash;
  argon2.verify = async (_hash, password) => {
    verifies++;
    active++;
    peak = Math.max(peak, active);
    try {
      if (gate) await gate;
      return password === "correct";
    } finally {
      active--;
    }
  };
  try {
    await assert.rejects(login(f.db, "missing", "bad", "s1"), status(401));
    await assert.rejects(login(f.db, "alice", "bad", "s1"), status(401));
    assert.equal(hashes, 1);
    assert.equal(verifies, 2);
    for (let i = 1; i < 10; i++)
      await assert.rejects(login(f.db, "alice", "bad", "s1"), status(401));
    await assert.rejects(login(f.db, "alice", "correct", "s1"), status(429));
    await assert.rejects(login(f.db, "alice", "bad", "s2"), {
      message: "Invalid username or password.",
    });
    await assert.rejects(login(f.db, "no-such-user", "bad", "s2"), {
      message: "Invalid username or password.",
    });
    await login(f.db, "alice", "correct", "s2");
    assert.equal(
      f.db
        .prepare("SELECT 1 FROM login_limits WHERE key=?")
        .get(tokenHash("s2\0alice")),
      undefined,
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM login_limits WHERE key=?")
        .get(tokenHash("s2\0no-such-user")),
    );
    assert.ok(
      f.db
        .prepare("SELECT 1 FROM login_limits WHERE key=?")
        .get(tokenHash("s1\0alice")),
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT attempts FROM login_limits WHERE key=?")
          .get("source:" + tokenHash("s2")) as { attempts: number }
      ).attempts,
      3,
    );
    for (let i = 0; i < 30; i++)
      await assert.rejects(
        login(f.db, "random" + i, "bad", "rotating"),
        status(401),
      );
    await assert.rejects(
      login(f.db, "another", "bad", "rotating"),
      status(429),
    );
    for (let i = 0; i < 10; i++)
      await assert.rejects(login(f.db, "absent", "bad", "s3"), status(401));
    await assert.rejects(login(f.db, "absent", "bad", "s3"), status(429));
    gate = new Promise<void>((r) => {
      release = r;
    });
    const work = Array.from({ length: 4 }, (_, i) =>
      login(f.db, "unknown", "bad", "parallel" + i).catch((e) => e),
    );
    await assert.rejects(login(f.db, "unknown", "bad", "excess"), status(429));
    release!();
    await Promise.all(work);
    assert.equal(peak, 4);
    assert.equal(
      (
        f.db.prepare("SELECT COUNT(*) n FROM password_work").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    argon2.hash = hash;
    argon2.verify = verify;
    f.db.close();
  }
});

test("quotas are transactional, independent, role-specific and count attached bytes", () => {
  const f = fixture();
  const saved = { ...process.env };
  Object.assign(process.env, {
    QUOTA_STUDENT_BYTES: "100",
    QUOTA_STUDENT_RETAINED: "90",
    QUOTA_STUDENT_REPORTS: "1",
    QUOTA_STUDENT_EVENTS: "1",
  });
  try {
    assert.ok(quotaLimit(f.w, "bytes") > quotaLimit(f.a, "bytes"));
    assert.throws(() =>
      f.db
        .transaction(() => {
          uploadQuota(f.db, f.a, 70);
          throw Error("rollback");
        })
        .immediate(),
    );
    assert.equal(
      (
        f.db.prepare("SELECT COUNT(*) n FROM usage_limits").get() as {
          n: number;
        }
      ).n,
      0,
    );
    const block = saveLocation(f.db, f.w, "blocks", {
      name: "A",
      code: "A",
    }).id;
    const level = saveLocation(f.db, f.w, "levels", {
      name: "L",
      code: "L",
      parent_id: block,
    }).id;
    const room = saveLocation(f.db, f.w, "rooms", {
      name: "1",
      parent_id: level,
    }).id;
    const photo = uid();
    f.db
      .transaction(() => {
        uploadQuota(f.db, f.a, 60);
        f.db
          .prepare("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)")
          .run(photo, f.a.id, photo + ".webp", 60, 1, 1, now());
      })
      .immediate();
    const draft = () => ({
      room_id: room,
      title: "Broken",
      description: "Needs repair",
      category: "Locks/doors",
      photos: [photo],
      submission_key: uid(),
    });
    const report = createReport(f.db, f.a, draft());
    assert.throws(
      () => f.db.transaction(() => uploadQuota(f.db, f.a, 50)).immediate(),
      status(429),
    );
    assert.throws(
      () => f.db.transaction(() => uploadQuota(f.db, f.a, 31)).immediate(),
      status(413),
    );
    f.db.transaction(() => uploadQuota(f.db, f.b, 50)).immediate();
    assert.throws(() => createReport(f.db, f.a, draft()), status(429));
    addEvent(f.db, f.a, report.id, {
      message: "Reply",
      photos: [],
      submission_key: uid(),
    });
    assert.throws(
      () =>
        addEvent(f.db, f.a, report.id, {
          message: "Again",
          photos: [],
          submission_key: uid(),
        }),
      status(429),
    );
    assert.throws(
      () =>
        addEvent(f.db, f.b, report.id, {
          message: "Forbidden",
          photos: [],
          submission_key: uid(),
        }),
      status(404),
    );
    f.db.transaction(() => consume(f.db, f.b, "mutations")).immediate();
  } finally {
    process.env = saved;
    f.db.close();
  }
});

test("production CSP nonces and security headers; development has no HSTS", async () => {
  const saved = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    const first = proxy(new NextRequest("https://paini.example.invalid/")),
      second = proxy(new NextRequest("https://paini.example.invalid/"));
    const csp = first.headers.get("content-security-policy")!;
    assert.match(csp, /nonce-/);
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.notEqual(csp, second.headers.get("content-security-policy"));
    const headers = (await config.headers!())[0].headers;
    for (const key of [
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ])
      assert.ok(headers.some((h) => h.key === key));
    Object.assign(process.env, { NODE_ENV: "development" });
    assert.ok(
      !(await config.headers!())[0].headers.some(
        (h) => h.key === "Strict-Transport-Security",
      ),
    );
  } finally {
    Object.assign(process.env, { NODE_ENV: saved });
  }
});

test("separate upload processes cannot race through daily bytes or retained storage", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile),
    directory = mkdtempSync(path.join(tmpdir(), "paini-quota-"));
  const f = fixture(),
    file = path.join(directory, "shared.db");
  try {
    await f.db.backup(file);
    const results = await Promise.all(
      [1, 2].map(() =>
        run(
          process.execPath,
          ["--import", "tsx", "tests/helpers/upload.ts", file, f.a.id],
          {
            env: {
              ...process.env,
              QUOTA_STUDENT_BYTES: "100",
              QUOTA_STUDENT_RETAINED: "100",
            },
          },
        ),
      ),
    );
    assert.deepEqual(results.map((r) => r.stdout).sort(), ["201", "429"]);
    const db = openDatabase(file);
    try {
      assert.equal(
        (db.prepare("SELECT SUM(bytes) n FROM uploads").get() as { n: number })
          .n,
        60,
      );
    } finally {
      db.close();
    }
  } finally {
    f.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("short upload limit and expired counters are independent of attachment accounting", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 20; i++)
      f.db.transaction(() => uploadQuota(f.db, f.a, 1)).immediate();
    assert.throws(
      () => f.db.transaction(() => uploadQuota(f.db, f.a, 1)).immediate(),
      status(429),
    );
    f.db
      .prepare("UPDATE usage_limits SET reset_at=0 WHERE kind='uploads'")
      .run();
    f.db.transaction(() => uploadQuota(f.db, f.a, 1)).immediate();
    assert.equal(
      (
        f.db
          .prepare(
            "SELECT used FROM usage_limits WHERE user_id=? AND kind='bytes'",
          )
          .get(f.a.id) as { used: number }
      ).used,
      21,
    );
  } finally {
    f.db.close();
  }
});

test("dummy initialization rejection is cached and cannot authenticate or leak work leases", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    "tests/helpers/dummy-failure.ts",
  ]);
});

test("session cookies remain secure in production even with a bad origin, and explicit HTTP development works", async () => {
  const { sessionCookieOptions } = await import("../src/lib/security-config");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      APP_ORIGIN: "http://invalid",
    });
    assert.deepEqual(sessionCookieOptions(true), {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/",
      maxAge: 86400,
    });
    Object.assign(process.env, {
      NODE_ENV: "development",
      APP_ORIGIN: "http://localhost:3000",
    });
    assert.equal(sessionCookieOptions(true).secure, false);
    assert.equal(sessionCookieOptions(false).maxAge, 0);
  } finally {
    process.env = saved;
  }
});

test("global ceiling cannot be bypassed by rotating source hints and usernames; success preserves global history", async () => {
  const f = fixture(),
    saved = { ...process.env },
    verify = argon2.verify;
  let calls = 0;
  argon2.verify = async (_hash, password) => {
    calls++;
    return password === "correct";
  };
  Object.assign(process.env, { LOGIN_GLOBAL_LIMIT: "5" });
  try {
    for (let i = 0; i < 4; i++)
      await assert.rejects(
        login(f.db, "absent" + i, "bad", "forged" + i),
        status(401),
      );
    await login(f.db, "alice", "correct", "different");
    await assert.rejects(
      login(f.db, "bob", "correct", "another-source"),
      status(429),
    );
    assert.equal(calls, 5);
    assert.equal(
      (
        f.db
          .prepare("SELECT attempts FROM login_limits WHERE key='global'")
          .get() as { attempts: number }
      ).attempts,
      5,
    );
    f.db.prepare("UPDATE login_limits SET reset_at=0 WHERE key='global'").run();
    await login(f.db, "bob", "correct", "another-source");
  } finally {
    argon2.verify = verify;
    process.env = saved;
    f.db.close();
  }
});

test("unknown sources share a bounded bucket without username-only lockouts", async () => {
  const f = fixture(),
    saved = { ...process.env },
    verify = argon2.verify;
  let calls = 0;
  argon2.verify = async (_hash, password) => {
    calls++;
    return password === "correct";
  };
  Object.assign(process.env, {
    LOGIN_UNKNOWN_SOURCE_LIMIT: "12",
    LOGIN_GLOBAL_LIMIT: "30",
  });
  try {
    for (let i = 0; i < 10; i++)
      await assert.rejects(login(f.db, "alice", "bad"), status(401));
    await login(f.db, "alice", "correct"); // No 15-minute username lockout.
    await assert.rejects(login(f.db, "rotated", "bad"), status(401));
    await assert.rejects(login(f.db, "bob", "correct"), status(429));
    assert.equal(calls, 12);
    await login(f.db, "alice", "correct", "valid-source-signal");
    assert.equal(
      (
        f.db
          .prepare("SELECT attempts FROM login_limits WHERE key=?")
          .get(UNKNOWN_SOURCE) as { attempts: number }
      ).attempts,
      12,
    );
    assert.equal(
      f.db
        .prepare("SELECT 1 FROM login_limits WHERE key=?")
        .get(tokenHash(UNKNOWN_SOURCE + "\0alice")),
      undefined,
    );
  } finally {
    argon2.verify = verify;
    process.env = saved;
    f.db.close();
  }
});

test("internal identifier key persists and corrupt state fails closed", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path");
  const directory = mkdtempSync(path.join(tmpdir(), "paini-identity-")),
    file = path.join(directory, "control.db");
  let db = openDatabase(file);
  try {
    db.exec("CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    const key = loginIdentifierKey(db);
    assert.equal(key.length, 32);
    assert.ok(key.equals(loginIdentifierKey(db)));
    db.close();
    db = openDatabase(file);
    assert.ok(key.equals(loginIdentifierKey(db)));
    const other = openDatabase(":memory:");
    try {
      other.exec(
        "CREATE TABLE state(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
      );
      assert.ok(!key.equals(loginIdentifierKey(other)));
    } finally {
      other.close();
    }
    db.prepare("UPDATE state SET value=? WHERE key=?").run(
      '"invalid"',
      "login_identifier_key",
    );
    assert.throws(() => loginIdentifierKey(db), {
      message: "Private login identifier state is invalid.",
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("simultaneous processes initialize and reuse one private identifier key", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path");
  const { execFile } = await import("node:child_process"),
    { promisify } = await import("node:util"),
    run = promisify(execFile);
  const directory = mkdtempSync(path.join(tmpdir(), "paini-identity-"));
  try {
    const identify = () =>
      run(
        process.execPath,
        ["--import", "tsx", "tests/helpers/login-identity.ts"],
        { env: { ...process.env, CONTROL_DIR: directory } },
      );
    const results = await Promise.all(Array.from({ length: 4 }, identify));
    assert.equal(new Set(results.map((r) => r.stdout)).size, 1);
    assert.match(results[0].stdout, /^[a-f0-9]{64}$/);
    assert.equal((await identify()).stdout, results[0].stdout);
    const db = openDatabase(path.join(directory, "operations.db"));
    try {
      assert.equal(
        (
          db
            .prepare("SELECT COUNT(*) n FROM state WHERE key=?")
            .get("login_identifier_key") as { n: number }
        ).n,
        1,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
