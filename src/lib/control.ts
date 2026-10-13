import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export interface RuntimeStorage {
  database: string;
  photos: string;
  prefix: string;
}
export interface Job {
  id: string;
  kind: "backup" | "validate" | "restore";
  status: string;
  actor: string;
  created_at: string;
  updated_at: string;
  progress: number;
  result: string | null;
  input: string;
  error: string | null;
}
let handle: Database.Database | undefined;
export function controlDir() {
  return path.resolve(
    /* turbopackIgnore: true */
    process.env.CONTROL_DIR ||
      path.join(
        path.dirname(process.env.DATABASE_PATH || "./data/paini.db"),
        "control",
      ),
  );
}
export function control() {
  if (!handle) {
    mkdirSync(controlDir(), { recursive: true });
    handle = new Database(path.join(controlDir(), "operations.db"));
    handle.pragma("journal_mode=WAL");
    handle.pragma("busy_timeout=5000");
    handle.exec(
      `CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,result TEXT,input TEXT NOT NULL,error TEXT); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,pid INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);`,
    );
  }
  return handle;
}
export function state<T>(key: string, fallback: T): T {
  const row = control()
    .prepare("SELECT value FROM state WHERE key=?")
    .get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : fallback;
}
export function setState(key: string, value: unknown) {
  control()
    .prepare(
      "INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, JSON.stringify(value));
}
export function runtimeStorage(): RuntimeStorage {
  return state("active", {
    database: path.resolve(
      /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
        "./data/paini.db",
    ),
    photos: path.resolve(
      /* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./data/photos",
    ),
    prefix: "",
  });
}
export function workerAvailable() {
  return Date.now() - state("heartbeat", 0) < 15000;
}
export function enterRequest(): string | null {
  return control()
    .transaction(() => {
      if (state("maintenance", false)) return null;
      const id = randomUUID();
      control()
        .prepare("INSERT INTO requests VALUES (?,?)")
        .run(id, process.pid);
      return id;
    })
    .immediate();
}
export function leaveRequest(id: string) {
  control().prepare("DELETE FROM requests WHERE id=?").run(id);
}
export function operationalAudit(
  actor: string,
  action: string,
  details: Record<string, unknown> = {},
) {
  control()
    .prepare("INSERT INTO audit VALUES (?,?,?,?,?)")
    .run(
      randomUUID(),
      actor,
      action,
      JSON.stringify(details),
      new Date().toISOString(),
    );
}
export function newJob(
  actor: string,
  kind: Job["kind"],
  input: Record<string, unknown> = {},
) {
  const id = randomUUID(),
    time = new Date().toISOString();
  control()
    .prepare(
      "INSERT INTO jobs(id,kind,status,actor,created_at,updated_at,input) VALUES (?,?,?,?,?,?,?)",
    )
    .run(id, kind, "queued", actor, time, time, JSON.stringify(input));
  operationalAudit(actor, kind + ".queued", { id });
  return { id };
}
export function updateJob(
  id: string,
  status: string,
  progress: number,
  result: unknown = null,
  error: string | null = null,
) {
  control()
    .prepare(
      "UPDATE jobs SET status=?,progress=?,result=?,error=?,updated_at=? WHERE id=?",
    )
    .run(
      status,
      progress,
      result ? JSON.stringify(result) : null,
      error,
      new Date().toISOString(),
      id,
    );
}
export const maxArchiveBytes = () =>
  Math.max(
    1024 * 1024,
    Number(process.env.MAX_BACKUP_BYTES) || 1024 * 1024 * 1024,
  );
