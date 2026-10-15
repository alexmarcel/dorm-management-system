import assert from "node:assert/strict";
import argon2 from "argon2";
import { openDatabase, migrate } from "../../src/lib/db";
import { login } from "../../src/lib/auth";
const db = openDatabase(":memory:");
migrate(db);
let hashes = 0,
  verifies = 0;
argon2.hash = (async () => {
  hashes++;
  throw Error("initialization unavailable");
}) as unknown as typeof argon2.hash;
argon2.verify = async () => {
  verifies++;
  return true;
};
async function main() {
  try {
    for (let i = 0; i < 2; i++)
      await assert.rejects(login(db, "absent", "password", "source"));
    assert.equal(hashes, 1);
    assert.equal(verifies, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) n FROM password_work").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
