import { randomUUID } from "node:crypto";
import type { DB } from "./db";
import { assert } from "./service";
import { configuredLimit } from "./limit-settings";
// Shared SQLite, same-host workers. Never expire a live worker's lease while
// Argon2 may still be running. Dead workers are reclaimed on the next attempt.
export async function passwordWork<T>(db: DB, work: () => Promise<T>) {
  const id = randomUUID();
  db.transaction(() => {
    for (const row of db
      .prepare("SELECT DISTINCT pid FROM password_work")
      .all() as { pid: number }[]) {
      try {
        process.kill(row.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          db.prepare("DELETE FROM password_work WHERE pid=?").run(row.pid);
      }
    }
    const count = db.prepare("SELECT COUNT(*) n FROM password_work").get() as {
      n: number;
    };
    assert(
      count.n < configuredLimit(db, "LOGIN_CONCURRENCY"),
      429,
      "Too many attempts. Try again later.",
    );
    db.prepare("INSERT INTO password_work VALUES (?,?)").run(id, process.pid);
  }).immediate();
  try {
    return await work();
  } finally {
    db.prepare("DELETE FROM password_work WHERE id=?").run(id);
  }
}
