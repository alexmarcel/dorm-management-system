import { limit } from "./security-config";
import { passwordWork } from "./password-work";
import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import type { DB } from "./db";
import { assert, now, userColumns } from "./service";
import type { User } from "./constants";
export const COOKIE = "paini_session";
export const tokenHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function passwordHash(password: string) {
  assert(
    password.length >= 8 && password.length <= 128,
    400,
    "Use a password between 8 and 128 characters.",
  );
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}
export function sessionUser(db: DB, token: string | undefined): User | null {
  if (!token) return null;
  return (
    (db
      .prepare(
        `SELECT ${userColumns
          .split(",")
          .map((c) => "u." + c)
          .join(
            ",",
          )} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,
      )
      .get(tokenHash(token), Date.now()) as User) || null
  );
}
export function session(db: DB, userId: string) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    tokenHash(token),
    userId,
    Date.now() + 86400000,
  );
  return token;
}
let dummyHash: Promise<string> | undefined;
export async function login(
  db: DB,
  username: string,
  password: string,
  source = "local-development",
) {
  const name = username.trim().toLowerCase(),
    bucket = tokenHash(source + "\0" + name),
    time = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM login_limits WHERE reset_at<=?").run(time);
    for (const [key, maximum, window] of [
      ["source:" + tokenHash(source), limit("LOGIN_SOURCE_LIMIT", 30), 60000],
      [bucket, limit("LOGIN_ACCOUNT_SOURCE_LIMIT", 10), 900000],
    ] as const) {
      const current = db
        .prepare("SELECT attempts FROM login_limits WHERE key=?")
        .get(key) as { attempts: number } | undefined;
      assert(
        !current || current.attempts < maximum,
        429,
        "Too many attempts. Try again later.",
      );
      db.prepare(
        "INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
      ).run(key, time + window);
    }
  }).immediate();
  return passwordWork(db, async () => {
    const row = db.prepare("SELECT * FROM users WHERE username=?").get(name) as
      (User & { password_hash: string }) | undefined;
    // Cache rejection too: initialization failure fails every attempt safely.
    // Both account paths wait for initialization and then perform one verify.
    dummyHash ??= passwordHash("dummy-password-for-timing");
    const dummy = await dummyHash;
    const valid = await argon2.verify(row?.password_hash || dummy, password);
    assert(row && valid && row.active, 401, "Invalid username or password.");
    return db
      .transaction(() => {
        const fresh = db
          .prepare("SELECT password_hash,active FROM users WHERE id=?")
          .get(row.id) as { password_hash: string; active: number };
        assert(
          fresh.active && fresh.password_hash === row.password_hash,
          401,
          "Invalid username or password.",
        );
        db.prepare("DELETE FROM login_limits WHERE key=?").run(bucket);
        return {
          token: session(db, row.id),
          user: db
            .prepare(`SELECT ${userColumns} FROM users WHERE id=?`)
            .get(row.id) as User,
        };
      })
      .immediate();
  });
}
export async function changePassword(
  db: DB,
  user: User,
  current: string,
  next: string,
) {
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(user.id) as { password_hash: string };
  assert(
    await passwordWork(db, () => argon2.verify(row.password_hash, current)),
    400,
    "Current password is incorrect.",
  );
  assert(current !== next, 400, "Choose a different password.");
  const hashed = await passwordHash(next);
  return db
    .transaction(() => {
      const fresh = db
        .prepare("SELECT active,password_hash FROM users WHERE id=?")
        .get(user.id) as { active: number; password_hash: string };
      assert(
        fresh.active && fresh.password_hash === row.password_hash,
        409,
        "Account changed. Sign in again.",
      );
      db.prepare(
        "UPDATE users SET password_hash=?,must_change=0 WHERE id=?",
      ).run(hashed, user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      return session(db, user.id);
    })
    .immediate();
}
export { now };
