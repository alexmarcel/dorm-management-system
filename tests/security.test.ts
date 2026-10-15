import { test } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { openDatabase, migrate } from "../src/lib/db";
import { login, tokenHash } from "../src/lib/auth";
import { securityConfig } from "../src/lib/security-config";
import { loginSource } from "../src/lib/login-source";
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
  TRUSTED_PROXY_MODE: "traefik-isolated",
  PROXY_SHARED_SECRET: "a".repeat(64),
  LOGIN_IDENTIFIER_KEY: "b".repeat(64),
};

test("production origin and proxy configuration fail closed; development is explicit", () => {
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
  assert.throws(() =>
    securityConfig({ ...production, TRUSTED_PROXY_MODE: undefined }),
  );
  assert.throws(() =>
    securityConfig({ ...production, LOGIN_IDENTIFIER_KEY: "bad" }),
  );
  assert.equal(
    securityConfig({ NODE_ENV: "development" }).origin,
    "http://localhost:3000",
  );
});

test("forwarding headers cannot override authenticated proxy identity", () => {
  const saved = { ...process.env };
  Object.assign(process.env, production);
  try {
    assert.throws(
      () => loginSource(new Headers({ "x-forwarded-for": "1.2.3.4" })),
      status(403),
    );
    const h = new Headers({
      "x-paini-proxy-secret": production.PROXY_SHARED_SECRET,
      "x-real-ip": "192.0.2.1",
    });
    const source = loginSource(h);
    h.set("x-forwarded-for", "8.8.8.8");
    assert.equal(loginSource(h), source);
    assert.ok(!source.includes("192.0.2"));
    h.set("x-real-ip", "192.0.2.1, 8.8.8.8");
    assert.throws(() => loginSource(h), status(403));
  } finally {
    process.env = saved;
  }
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
