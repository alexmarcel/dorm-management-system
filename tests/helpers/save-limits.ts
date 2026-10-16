import { openDatabase } from "../../src/lib/db";
import { limitSnapshot, saveLimits } from "../../src/lib/limit-settings";
import type { User } from "../../src/lib/constants";
const [file, revision, value] = process.argv.slice(2),
  db = openDatabase(file);
try {
  const actor = db
    .prepare("SELECT * FROM users WHERE role='superadmin'")
    .get() as User;
  saveLimits(db, actor, {
    revision,
    values: { ...limitSnapshot(db).values, LOGIN_GLOBAL_LIMIT: Number(value) },
  });
  process.stdout.write("200");
} catch (e) {
  process.stdout.write(String((e as { status: number }).status));
} finally {
  db.close();
}
