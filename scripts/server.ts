import { securityConfig } from "../src/lib/security-config";
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  control,
  state,
  setState,
  type RuntimeStorage,
  type Job,
} from "../src/lib/control";
import { getDb, migrate } from "../src/lib/db";
import { bootstrapAdmin } from "../src/lib/admin";
import { runJob } from "../src/lib/jobs";

async function main() {
  securityConfig({ ...process.env, NODE_ENV: process.argv[2] === "dev" ? "development" : "production" });
  control()
    .transaction(() => {
      const owner = state<number>("supervisor_pid", 0);
      if (owner) {
        let alive = false;
        try {
          process.kill(owner, 0);
          alive = true;
        } catch {}
        if (alive)
          throw new Error("A supervisor already owns this control directory.");
      }
      setState("supervisor_pid", process.pid);
    })
    .immediate();
  process.on("exit", () => {
    if (state("supervisor_pid", 0) === process.pid) {
      setState("supervisor_pid", 0);
      setState("heartbeat", 0);
    }
  });
  const mode = process.argv[2] === "dev" ? "dev" : "start",
    args = process.argv.slice(3);
  const portIndex = args.indexOf("--port"),
    port =
      portIndex >= 0
        ? Number(args[portIndex + 1])
        : Number(process.env.PORT || 3000);
  const recovery = state<{ previous: RuntimeStorage; job: string } | null>(
    "restore_recovery",
    null,
  );
  if (recovery) {
    setState("active", recovery.previous);
    setState("restore_recovery", null);
  }
  setState("maintenance", false);
  control().prepare("DELETE FROM requests").run();
  control()
    .prepare(
      "UPDATE jobs SET status='failed',error='Operation interrupted. Previous data retained.' WHERE status IN ('running','uploading')",
    )
    .run();
  const db = getDb();
  migrate(db);
  await bootstrapAdmin(db);
  let child: ChildProcess | undefined,
    quitting = false;
  async function stop() {
    if (!child) return;
    const current = child;
    child = undefined;
    if (current.exitCode !== null || current.signalCode !== null) {
      if (current.pid)
        control().prepare("DELETE FROM requests WHERE pid=?").run(current.pid);
      return;
    }
    await new Promise<void>((resolve) => {
      current.once("exit", () => resolve());
      current.kill("SIGTERM");
      setTimeout(() => {
        if (current.exitCode === null) current.kill("SIGKILL");
      }, 5000).unref();
    });
    if (current.pid)
      control().prepare("DELETE FROM requests WHERE pid=?").run(current.pid);
  }
  async function start() {
    child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), "node_modules/next/dist/bin/next"),
        mode,
        ...args,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_ENV: mode === "dev" ? "development" : "production",
        },
        windowsHide: true,
      },
    );
    child.on("error", () => {});
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Application process exited.");
      try {
        const r = await fetch(`http://localhost:${port}/api/health`);
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Application health check timed out.");
  }
  const heartbeat = setInterval(() => setState("heartbeat", Date.now()), 1000);
  setState("heartbeat", Date.now());
  process.on("SIGINT", () => {
    quitting = true;
    void stop().then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    quitting = true;
    void stop().then(() => process.exit(0));
  });
  await start();
  while (!quitting) {
    const job = control()
      .prepare(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
      )
      .get() as Job | undefined;
    if (job) await runJob(job, { start, stop });
    else await new Promise((r) => setTimeout(r, 500));
    if (
      child &&
      (child.exitCode !== null || child.signalCode !== null) &&
      !quitting
    ) {
      if (child.pid)
        control().prepare("DELETE FROM requests WHERE pid=?").run(child.pid);
      await start();
    }
  }
  clearInterval(heartbeat);
}
main().catch((e) => {
  console.error("PAINI supervisor:", e.message);
  process.exit(1);
});
