import { z } from "zod";
import argon2 from "argon2";
import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import type { DB } from "./db";
import type { User } from "./constants";
import {
  assert,
  AppError,
  activeActor,
  uid,
  now,
  userColumns,
} from "./service";
import { passwordHash } from "./auth";
import { initialPasswordChange } from "./account-policy";

export function superadmin(actor: User) {
  assert(actor.role === "superadmin", 403, "Superadmin access required.");
}
export function audit(
  db: DB,
  actor: User,
  action: string,
  target: string | null,
  details: Record<string, unknown> = {},
) {
  db.prepare("INSERT INTO admin_audit VALUES (?,?,?,?,?,?)").run(
    uid(),
    actor.id,
    action,
    target,
    JSON.stringify(details),
    now(),
  );
}
export async function bootstrapAdmin(
  db: DB,
  env: Record<string, string | undefined> = process.env,
) {
  const existing = db
    .prepare("SELECT id FROM users WHERE role='superadmin'")
    .get();
  const username = env.PAINI_SUPERADMIN_USERNAME?.trim().toLowerCase(),
    password = env.PAINI_SUPERADMIN_PASSWORD;
  if (username)
    assert(
      !db
        .prepare("SELECT id FROM users WHERE username=? AND role!='superadmin'")
        .get(username),
      409,
      "Superadmin username belongs to another account.",
    );
  if (existing) return { created: false };
  if (!username && !password) return { created: false };
  assert(
    username && /^[a-z0-9_.-]{3,60}$/.test(username) && password,
    400,
    "Configure a valid superadmin username and password.",
  );
  assert(
    !db.prepare("SELECT id FROM users WHERE username=?").get(username),
    409,
    "Superadmin username belongs to another account.",
  );
  const hash = await passwordHash(password);
  return db
    .transaction(() => {
      if (db.prepare("SELECT id FROM users WHERE role='superadmin'").get())
        return { created: false };
      assert(
        !db.prepare("SELECT id FROM users WHERE username=?").get(username),
        409,
        "Superadmin username belongs to another account.",
      );
      db.prepare(
        "INSERT INTO users(id,name,username,password_hash,role,created_at) VALUES (?,'Superadmin',?,?,'superadmin',?)",
      ).run(uid(), username, hash, now());
      return { created: true };
    })
    .immediate();
}
export async function verifyAdminPassword(
  db: DB,
  actor: User,
  password: string,
) {
  superadmin(activeActor(db, actor));
  const bucket = "admin-verify:" + actor.id,
    time = Date.now();
  db.prepare("DELETE FROM login_limits WHERE reset_at<?").run(time);
  const attempt = db
    .prepare("SELECT attempts FROM login_limits WHERE key=?")
    .get(bucket) as { attempts: number } | undefined;
  assert(
    !attempt || attempt.attempts < 10,
    429,
    "Too many attempts. Try again in 15 minutes.",
  );
  db.prepare(
    "INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
  ).run(bucket, time + 900000);
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id=?")
    .get(actor.id) as { password_hash: string };
  assert(
    await argon2.verify(row.password_hash, password),
    400,
    "Current password is incorrect.",
  );
  db.prepare("DELETE FROM login_limits WHERE key=?").run(bucket);
}
const wardenSchema = z.object({
  name: z.string().trim().min(1).max(200),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,60}$/),
  password: z.string().min(8).max(128).optional(),
  active: z.boolean().default(true),
});
export function listWardens(db: DB, actor: User, params: URLSearchParams) {
  superadmin(actor);
  const q = `%${params.get("q") || ""}%`,
    archived = params.get("archived") === "true";
  return db
    .prepare(
      `SELECT ${userColumns} FROM users WHERE role='warden' AND archived_at IS ${archived ? "NOT " : ""}NULL AND (name LIKE ? OR username LIKE ?) ORDER BY name`,
    )
    .all(q, q) as User[];
}
export async function manageWarden(
  db: DB,
  actor: User,
  id: string | undefined,
  input: unknown,
) {
  superadmin(actor);
  const action = z
    .object({
      action: z.enum(["save", "reset", "archive", "restore"]).default("save"),
    })
    .parse(input).action;
  const d = action === "save" ? wardenSchema.parse(input) : null;
  const reset =
    action === "reset"
      ? z.object({ password: z.string().min(8).max(128) }).parse(input)
      : null;
  if (!id)
    assert(
      action === "save" && d?.password,
      400,
      "Initial password is required.",
    );
  const hash = reset
    ? await passwordHash(reset.password)
    : d?.password
      ? await passwordHash(d.password)
      : null;
  return db
    .transaction(() => {
      superadmin(activeActor(db, actor));
      const target = id
        ? (db
            .prepare("SELECT * FROM users WHERE id=? AND role='warden'")
            .get(id) as User | undefined)
        : undefined;
      if (id) assert(target, 404, "Warden not found.");
      const resultId = id || uid();
      if (action === "save" && d) {
        assert(
          !target?.archived_at,
          409,
          "Restore the archived account before editing.",
        );
        if (id)
          db.prepare(
            "UPDATE users SET name=?,username=?,active=? WHERE id=?",
          ).run(d.name, d.username, +d.active, id);
        else
          db.prepare(
            "INSERT INTO users(id,name,username,password_hash,role,active,created_at,must_change) VALUES (?,?,?,?,'warden',?,?,?)",
          ).run(
            resultId,
            d.name,
            d.username,
            hash,
            +d.active,
            now(),
            initialPasswordChange(db),
          );
        if (id && !d.active)
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      } else if (action === "reset") {
        assert(
          !target?.archived_at,
          409,
          "Restore the archived account before editing.",
        );
        db.prepare(
          "UPDATE users SET password_hash=?,must_change=? WHERE id=?",
        ).run(hash, initialPasswordChange(db), id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      } else if (action === "archive") {
        db.prepare("UPDATE users SET active=0,archived_at=? WHERE id=?").run(
          now(),
          id,
        );
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      } else if (action === "restore")
        db.prepare("UPDATE users SET active=1,archived_at=NULL WHERE id=?").run(
          id,
        );
      audit(db, actor, "warden." + action, resultId);
      return { id: resultId };
    })
    .immediate();
}
const csvRow = z.object({
  fullname: z.string().trim().min(1).max(200),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,60}$/),
  password: z.string().min(8).max(128),
  "phone number": z.string().trim().max(40).default(""),
  email: z.union([z.email().max(254), z.literal("")]).default(""),
});
type CsvRow = z.infer<typeof csvRow>;
export interface CsvError {
  row: number;
  field: string;
  code: string;
}
function readCsv(db: DB, csv: string) {
  assert(
    Buffer.byteLength(csv, "utf8") <= 2 * 1024 * 1024,
    413,
    "CSV files must be 2 MB or smaller.",
  );
  let raw: { record: Record<string, string>; info: { lines: number } }[];
  try {
    raw = parse(csv, {
      bom: true,
      skip_empty_lines: true,
      info: true,
      columns: (columns: string[]) => {
        const normalized = columns.map((c) => c.trim().toLowerCase());
        assert(
          new Set(normalized).size === normalized.length &&
            ["fullname", "username", "password"].every((c) =>
              normalized.includes(c),
            ) &&
            normalized.every((c) =>
              [
                "fullname",
                "username",
                "password",
                "phone number",
                "email",
              ].includes(c),
            ),
          400,
          "CSV headers are invalid.",
        );
        return normalized;
      },
    });
  } catch {
    throw new AppError(400, "CSV headers or rows are invalid.");
  }
  assert(
    raw.length > 0 && raw.length <= 1000,
    400,
    "CSV must contain between 1 and 1000 students.",
  );
  const rows: CsvRow[] = [],
    errors: CsvError[] = [],
    seen = new Set<string>(),
    seenIds = new Set<string>();
  for (const entry of raw) {
    const parsed = csvRow.safeParse(entry.record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push({
          row: entry.info.lines,
          field: String(issue.path[0]),
          code: "invalid_field",
        });
      continue;
    }
    const row = parsed.data,
      studentId = row.username.toUpperCase();
    if (
      seen.has(row.username) ||
      seenIds.has(studentId) ||
      db
        .prepare("SELECT id FROM users WHERE username=? OR student_id=?")
        .get(row.username, studentId)
    )
      errors.push({
        row: entry.info.lines,
        field: "username",
        code: "account_exists",
      });
    seen.add(row.username);
    seenIds.add(studentId);
    rows.push(row);
  }
  return { rows, errors };
}
export function previewCsv(db: DB, actor: User, csv: string) {
  superadmin(actor);
  const { rows, errors } = readCsv(db, csv);
  return {
    valid: errors.length === 0,
    count: rows.length,
    errors,
    rows: rows.map(({ password, ...r }) => ({
      ...r,
      student_id: r.username.toUpperCase(),
    })),
  };
}
export async function importCsv(
  db: DB,
  actor: User,
  csv: string,
  operationId: string,
) {
  superadmin(actor);
  z.uuid().parse(operationId);
  const fingerprint = createHash("sha256").update(csv).digest("hex");
  const previous = () =>
    db
      .prepare(
        "SELECT actor_id,fingerprint,student_count FROM student_imports WHERE id=?",
      )
      .get(operationId) as
      | { actor_id: string; fingerprint: string; student_count: number }
      | undefined;
  const prior = previous();
  if (prior) {
    assert(
      prior.actor_id === actor.id && prior.fingerprint === fingerprint,
      409,
      "Import identifier already used.",
    );
    return { count: prior.student_count };
  }
  const parsed = readCsv(db, csv);
  assert(
    parsed.errors.length === 0,
    400,
    "Fix all CSV errors before importing.",
  );
  const hashes: string[] = [];
  for (const r of parsed.rows) hashes.push(await passwordHash(r.password));
  return db
    .transaction(() => {
      superadmin(activeActor(db, actor));
      const prior = previous();
      if (prior) {
        assert(
          prior.actor_id === actor.id && prior.fingerprint === fingerprint,
          409,
          "Import identifier already used.",
        );
        return { count: prior.student_count };
      }
      const current = readCsv(db, csv);
      assert(
        !current.errors.length,
        409,
        "An account now conflicts with this import. Validate the file again.",
      );
      current.rows.forEach((r, i) =>
        db
          .prepare(
            "INSERT INTO users(id,name,username,password_hash,role,student_id,phone,email,created_at,must_change) VALUES (?,?,?,?,'student',?,?,?,?,?)",
          )
          .run(
            uid(),
            r.fullname,
            r.username,
            hashes[i],
            r.username.toUpperCase(),
            r["phone number"] || null,
            r.email || null,
            now(),
            initialPasswordChange(db),
          ),
      );
      db.prepare("INSERT INTO student_imports VALUES (?,?,?,?,?)").run(
        operationId,
        actor.id,
        fingerprint,
        current.rows.length,
        now(),
      );
      audit(db, actor, "students.import", operationId, {
        count: current.rows.length,
      });
      return { count: current.rows.length };
    })
    .immediate();
}
