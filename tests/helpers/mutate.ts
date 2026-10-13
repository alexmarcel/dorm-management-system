import { openDatabase } from "../../src/lib/db";
import { addEvent, uid, AppError } from "../../src/lib/service";
import type { User } from "../../src/lib/constants";
async function main() {
  const [file, userId, reportId, mode, start, timeout] = process.argv.slice(2);
  const db = openDatabase(file);
  if (timeout) db.pragma(`busy_timeout = ${Number(timeout)}`);
  const actor = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(userId) as User;
  const wait = Number(start) - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    const result = addEvent(db, actor, reportId, {
      message: mode === "close" ? "Closed by worker" : "Worker reply",
      submission_key: uid(),
      ...(mode === "close"
        ? { status: "Closed", expected_status: "Submitted" }
        : {}),
    });
    process.stdout.write(JSON.stringify({ ok: true, ...result }));
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        status: e instanceof AppError ? e.status : 0,
        code: (e as { code?: string }).code,
      }),
    );
  } finally {
    db.close();
  }
}
void main();
