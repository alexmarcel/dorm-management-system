import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getDb, migrate } from "../src/lib/db";
import { passwordHash } from "../src/lib/auth";
import { uid, now } from "../src/lib/service";
import { deletePhoto } from "../src/lib/storage";
import { bootstrapAdmin } from "../src/lib/admin";
import { initialPasswordChange } from "../src/lib/account-policy";
import {
  newJob,
  workerAvailable,
  enterRequest,
  leaveRequest,
  operationalAudit,
} from "../src/lib/control";

async function main() {
  const command = process.argv[2],
    db = getDb();
  if (command === "migrate") {
    migrate(db);
    await bootstrapAdmin(db);
    console.log("Migrations applied.");
  } else if (command === "superadmin") {
    migrate(db);
    const result = await bootstrapAdmin(db);
    console.log(
      result.created
        ? "Superadmin created; password change required."
        : "No account created. Existing credentials were not changed.",
    );
  } else if (command === "recover-superadmin") {
    const password = process.env.SUPERADMIN_RECOVERY_PASSWORD;
    if (!password)
      throw new Error(
        "Set SUPERADMIN_RECOVERY_PASSWORD explicitly to recover the account.",
      );
    const hash = await passwordHash(password);
    db.transaction(() => {
      const account = db
        .prepare("SELECT id FROM users WHERE role='superadmin'")
        .get() as { id: string } | undefined;
      if (!account) throw new Error("No superadmin exists. Run setup first.");
      db.prepare(
        "UPDATE users SET password_hash=?,must_change=1 WHERE id=?",
      ).run(hash, account.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(account.id);
    }).immediate();
    console.log("Superadmin password reset; sessions revoked.");
    operationalAudit("server", "superadmin.recovery");
  } else if (command === "warden") {
    migrate(db);
    const rl = createInterface({ input: stdin, output: stdout });
    const name =
      process.env.WARDEN_NAME || (await rl.question("Warden full name: "));
    const username = (
      process.env.WARDEN_USERNAME || (await rl.question("Username: "))
    )
      .trim()
      .toLowerCase();
    // Password is supplied through an environment variable, never a command-line argument or echoed prompt.
    const password = process.env.WARDEN_PASSWORD;
    rl.close();
    if (!name.trim() || !/^[a-z0-9_.-]{3,60}$/.test(username) || !password)
      throw new Error(
        "Supply WARDEN_PASSWORD securely in the environment (12–128 characters), plus a valid name and username.",
      );
    const hash = await passwordHash(password);
    db.prepare(
      "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES (?,?,?,?,'warden',?,?)",
    ).run(uid(), name.trim(), username, hash, initialPasswordChange(db), now());
    console.log("Warden created using the configured password-change policy.");
  } else if (command === "backup") {
    if (!workerAvailable())
      throw new Error("Start the supervised server before queuing a backup.");
    console.log("Complete backup queued:", newJob("server", "backup").id);
  } else if (command === "cleanup") {
    const lease = enterRequest();
    if (!lease)
      throw new Error("Maintenance in progress. Retry cleanup later.");
    try {
      const cutoff = new Date(Date.now() - 86400000).toISOString();
      const items = db
        .prepare(
          "SELECT u.id,u.object_key FROM uploads u LEFT JOIN attachments a ON a.id=u.id WHERE a.id IS NULL AND u.created_at<?",
        )
        .all(cutoff) as { id: string; object_key: string }[];
      // Expired uploads cannot be attached by the API, so cleanup cannot race valid attachment finalization.
      for (const item of items) {
        await deletePhoto(item.object_key);
        db.prepare(
          "DELETE FROM uploads WHERE id=? AND NOT EXISTS(SELECT 1 FROM attachments WHERE id=?)",
        ).run(item.id, item.id);
      }
      db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
      db.prepare("DELETE FROM login_limits WHERE reset_at<?").run(Date.now());
      console.log(`Cleaned ${items.length} expired uploads.`);
    } finally {
      leaveRequest(lease);
    }
  } else throw new Error("Use migrate, warden, backup, or cleanup.");
  db.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
