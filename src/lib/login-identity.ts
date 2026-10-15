import { randomBytes } from "node:crypto";
import { control } from "./control";
import type { DB } from "./db";

// The existing private control store survives app restarts and restores. No
// operator secret or new schema is needed. IMMEDIATE serializes first startup.
export function loginIdentifierKey(db: DB = control()): Buffer {
  return db
    .transaction(() => {
      const row = db
        .prepare("SELECT value FROM state WHERE key=?")
        .get("login_identifier_key") as { value: string } | undefined;
      if (row) {
        let key: unknown;
        try {
          key = JSON.parse(row.value);
        } catch {
          /* Fail closed below. */
        }
        if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
          throw new Error("Private login identifier state is invalid.");
        return Buffer.from(key, "hex");
      }
      const key = randomBytes(32);
      db.prepare("INSERT INTO state(key,value) VALUES (?,?)").run(
        "login_identifier_key",
        JSON.stringify(key.toString("hex")),
      );
      return key;
    })
    .immediate();
}
