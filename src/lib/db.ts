import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runtimeStorage } from "./control";

export type DB = Database.Database;
export function openDatabase(filename: string): DB {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}
export function migrate(db: DB) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const name of readdirSync(path.join(process.cwd(), "migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        if (db.prepare("SELECT 1 FROM migrations WHERE name=?").get(name))
          return;
        db.exec(
          readFileSync(path.join(process.cwd(), "migrations", name), "utf8"),
        );
        db.prepare("INSERT INTO migrations VALUES (?,?)").run(
          name,
          new Date().toISOString(),
        );
        if ((db.pragma("foreign_key_check") as unknown[]).length)
          throw new Error("Migration foreign-key validation failed.");
      }).immediate();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}
const globalDb = globalThis as unknown as { painiDb?: DB };
export function getDb() {
  if (!globalDb.painiDb) {
    globalDb.painiDb = openDatabase(runtimeStorage().database);
    if (process.env.NODE_ENV !== "production") migrate(globalDb.painiDb);
  }
  return globalDb.painiDb;
}
