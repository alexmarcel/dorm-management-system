import { openDatabase } from "../../src/lib/db";
import { uploadQuota } from "../../src/lib/quotas";
import { uid, now } from "../../src/lib/service";
import type { User } from "../../src/lib/constants";
const [file, userId] = process.argv.slice(2);
const db = openDatabase(file);
try {
  const actor = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(userId) as User;
  db.transaction(() => {
    uploadQuota(db, actor, 60);
    const id = uid();
    db.prepare("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)").run(
      id,
      actor.id,
      id + ".webp",
      60,
      1,
      1,
      now(),
    );
  }).immediate();
  process.stdout.write("201");
} catch (e) {
  process.stdout.write(String((e as { status: number }).status));
} finally {
  db.close();
}
