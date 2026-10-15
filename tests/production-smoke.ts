// Run after npm run build. Isolated synthetic data; no deployment secrets needed.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { openDatabase, migrate } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";

async function main() {
  const directory = mkdtempSync(path.join(tmpdir(), "paini-production-")),
    port = 3217;
  const origin = `https://localhost:${port}`,
    base = `http://localhost:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "production" as const,
    APP_ORIGIN: origin,
    DATABASE_PATH: path.join(directory, "test.db"),
    CONTROL_DIR: path.join(directory, "control"),
    UPLOAD_DIR: path.join(directory, "photos"),
    TRUSTED_PROXY_MODE: "traefik-isolated",
    PROXY_SHARED_SECRET: "a".repeat(64),
    LOGIN_IDENTIFIER_KEY: "b".repeat(64),
    QUOTA_WARDEN_MUTATIONS: "2",
  };
  const db = openDatabase(env.DATABASE_PATH);
  migrate(db);
  db.prepare(
    "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES ('test','Test','test',?,'warden',0,?)",
  ).run(await passwordHash("Synthetic-password-123"), new Date().toISOString());
  db.close();
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env, stdio: "pipe", windowsHide: true },
  );
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const browser = await chromium.launch();
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, output);
    const html = await fetch(base);
    assert.equal(
      html.headers.get("strict-transport-security"),
      "max-age=31536000",
    );
    assert.ok(html.headers.get("content-security-policy"));
    for (const header of [
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
    ])
      assert.ok(html.headers.get(header));
    const anonymous = await fetch(base + "/api/reports");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
    for (const requestOrigin of [undefined, "https://hostile.invalid"]) {
      const r = await fetch(base + "/api/reports", {
        method: "POST",
        headers: requestOrigin ? { Origin: requestOrigin } : {},
        body: "invalid",
      });
      assert.equal(r.status, 403);
    }
    const unauth = await fetch(base + "/api/reports", {
      method: "POST",
      headers: { Origin: origin },
      body: "invalid",
    });
    assert.equal(unauth.status, 401);
    const signed = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Paini-Proxy-Secret": env.PROXY_SHARED_SECRET,
        "X-Real-IP": "192.0.2.1",
      },
      body: JSON.stringify({
        username: "test",
        password: "Synthetic-password-123",
      }),
    });
    assert.equal(signed.status, 200);
    const cookie = signed.headers.get("set-cookie")!;
    for (const flag of [
      "Secure",
      "HttpOnly",
      "SameSite=strict",
      "Path=/",
      "Max-Age=86400",
    ])
      assert.ok(cookie.includes(flag), cookie);
    const writeHeaders = {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie.split(";")[0],
    };
    const invalid = await fetch(base + "/api/locations/blocks", {
      method: "POST",
      headers: writeHeaders,
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    for (let i = 0; i < 2; i++) {
      const result = await fetch(base + "/api/locations/blocks", {
        method: "POST",
        headers: writeHeaders,
        body: JSON.stringify({ name: "Block " + i, code: "B" + i }),
      });
      assert.equal(result.status, 200);
    }
    const limited = await fetch(base + "/api/locations/blocks", {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({ name: "Excess", code: "EXCESS" }),
    });
    assert.equal(limited.status, 429);
    const context = await browser.newContext();
    const page = await context.newPage();
    const violations: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.exposeFunction("recordViolation", (directive: string) =>
      violations.push(directive),
    );
    await page.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (e) =>
        (
          window as unknown as { recordViolation: (s: string) => void }
        ).recordViolation(e.violatedDirective),
      ),
    );
    await page.goto(base);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await context.addCookies([
      {
        name: "paini_session",
        value: cookie.split(";")[0].split("=")[1],
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    await page.goto(base);
    await page.getByRole("heading", { name: "Hello, Test." }).waitFor();
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    console.log(
      "Production smoke passed: enforced CSP rendering, authenticated dashboard, cookie flags, HSTS, permissions, private API caching, authentication and exact-origin rejection.",
    );
  } finally {
    await browser.close();
    child.kill();
    await once(child, "exit");
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
