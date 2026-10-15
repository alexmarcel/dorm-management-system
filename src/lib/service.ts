import { consume } from "./quotas";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "./db";
import {
  CATEGORIES,
  STATUSES,
  type User,
  type Report,
  type Locations,
  type TimelineEvent,
} from "./constants";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  get code() {
    return this.message;
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
const text = z.string().trim().min(1).max(200);
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,20}$/);
const key = z.string().uuid();
const photos = z
  .array(key)
  .max(5)
  .default([])
  .refine((a) => new Set(a).size === a.length);
export const newReportSchema = z.object({
  room_id: key,
  title: text,
  description: z.string().trim().min(1).max(10000),
  category: z.enum(CATEGORIES),
  submission_key: key,
  photos,
});
export const eventSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  status: z.enum(STATUSES).optional(),
  expected_status: z.enum(STATUSES).optional(),
  submission_key: key,
  photos,
});
export const studentSchema = z.object({
  phone: z.string().trim().max(40).optional().default(""),
  email: z
    .union([z.email().max(254), z.literal("")])
    .optional()
    .default(""),
  name: text,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,60}$/),
  student_id: text.transform((s) => s.toUpperCase()),
  room_id: key.nullable().default(null),
  active: z.boolean().default(true),
  password: z.string().min(8).max(128).optional(),
});
const locationSchema = z.object({
  id: key.optional(),
  name: text,
  code: code.optional(),
  parent_id: key.optional(),
  sort_order: z.number().int().min(-100).max(1000).default(0),
  archived: z.boolean().default(false),
});
export const userColumns =
  "id,name,username,role,student_id,room_id,active,must_change,phone,email,archived_at,created_at";
export function activeActor(db: DB, user: User) {
  const fresh = db
    .prepare(
      `SELECT ${userColumns} FROM users WHERE id=? AND active=1 AND archived_at IS NULL`,
    )
    .get(user.id) as User | undefined;
  assert(
    fresh && !fresh.must_change,
    403,
    "Your account is not available. Sign in again.",
  );
  return fresh;
}
export function warden(user: User) {
  assert(user.role === "warden", 403, "Warden access required.");
}
export function archiveStudent(db:DB,actor:User,id:string,archived=true){
  return db.transaction(()=>{
    warden(activeActor(db,actor));
    const student=db.prepare("SELECT id FROM users WHERE id=? AND role='student'").get(id);
    assert(student,404,'Student not found.');
    if(archived)db.prepare('UPDATE users SET active=0,archived_at=COALESCE(archived_at,?) WHERE id=?').run(now(),id);
    else db.prepare('UPDATE users SET active=1,archived_at=NULL WHERE id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('INSERT INTO admin_audit VALUES (?,?,?,?,?,?)').run(uid(),actor.id,archived?'student.archive':'student.restore',id,'{}',now());
    return {ok:true};
  }).immediate();
}
export function maintenanceUser(user: User) {
  assert(
    user.role === "student" || user.role === "warden",
    403,
    "Maintenance access is not available to this account.",
  );
}
export function locations(db: DB): Locations {
  return {
    blocks: db
      .prepare("SELECT * FROM blocks ORDER BY name")
      .all() as Locations["blocks"],
    levels: db
      .prepare("SELECT * FROM levels ORDER BY sort_order,name")
      .all() as Locations["levels"],
    rooms: (
      db
        .prepare(
          `SELECT r.*, l.block_id, b.name||' / '||l.name||' / '||r.name label, CASE WHEN r.archived=0 AND l.archived=0 AND b.archived=0 THEN 1 ELSE 0 END available FROM rooms r JOIN levels l ON l.id=r.level_id JOIN blocks b ON b.id=l.block_id`,
        )
        .all() as Locations["rooms"]
    ).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    ),
  };
}
export function availableRoom(db: DB, id: string) {
  return db
    .prepare(
      `SELECT r.id, l.id level_id, b.code block_code, l.code level_code FROM rooms r JOIN levels l ON r.level_id=l.id JOIN blocks b ON l.block_id=b.id WHERE r.id=? AND r.archived=0 AND l.archived=0 AND b.archived=0`,
    )
    .get(id) as
    | { id: string; level_id: string; block_code: string; level_code: string }
    | undefined;
}
export function saveLocation(
  db: DB,
  actor: User,
  kind: string,
  input: unknown,
) {
  warden(actor);
  assert(
    ["blocks", "levels", "rooms"].includes(kind),
    400,
    "Invalid location type.",
  );
  const d = locationSchema.parse(input);
  return db
    .transaction(() => {
      warden(activeActor(db, actor));
      const id = d.id || uid();
      if (d.id)
        assert(
          db.prepare(`SELECT id FROM ${kind} WHERE id=?`).get(id),
          404,
          "Location not found.",
        );
      if (kind !== "rooms") assert(d.code, 400, "A code is required.");
      if (kind === "blocks") {
        if (d.id)
          db.prepare(
            "UPDATE blocks SET name=?,code=?,archived=? WHERE id=?",
          ).run(d.name, d.code, +d.archived, id);
        else
          db.prepare("INSERT INTO blocks(id,name,code) VALUES (?,?,?)").run(
            id,
            d.name,
            d.code,
          );
      }
      if (kind === "levels") {
        if (d.id)
          db.prepare(
            "UPDATE levels SET name=?,code=?,sort_order=?,archived=? WHERE id=?",
          ).run(d.name, d.code, d.sort_order, +d.archived, id);
        else {
          assert(
            d.parent_id &&
              db
                .prepare("SELECT id FROM blocks WHERE id=? AND archived=0")
                .get(d.parent_id),
            400,
            "Select an active block.",
          );
          db.prepare(
            "INSERT INTO levels(id,block_id,name,code,sort_order) VALUES (?,?,?,?,?)",
          ).run(id, d.parent_id, d.name, d.code, d.sort_order);
        }
      }
      if (kind === "rooms") {
        if (d.id)
          db.prepare("UPDATE rooms SET name=?,archived=? WHERE id=?").run(
            d.name,
            +d.archived,
            id,
          );
        else {
          assert(
            d.parent_id &&
              db
                .prepare(
                  "SELECT l.id FROM levels l JOIN blocks b ON b.id=l.block_id WHERE l.id=? AND l.archived=0 AND b.archived=0",
                )
                .get(d.parent_id),
            400,
            "Select an active level.",
          );
          db.prepare("INSERT INTO rooms(id,level_id,name) VALUES (?,?,?)").run(
            id,
            d.parent_id,
            d.name,
          );
        }
      }
      return { id };
    })
    .immediate();
}
export const reportSelect = `SELECT r.*, b.id block_id, l.id level_id, b.name block_name, b.name||' / '||l.name||' / '||rm.name location, u.name creator_name FROM reports r JOIN rooms rm ON rm.id=r.room_id JOIN levels l ON l.id=rm.level_id JOIN blocks b ON b.id=l.block_id JOIN users u ON u.id=r.creator_id`;
export function presentReport(r: Report): Report {
  if (r.snapshot) {
    const s = JSON.parse(r.snapshot);
    return { ...r, location: s.location, creator_name: s.creator_name };
  }
  return r;
}
export function getReport(db: DB, actor: User, id: string): Report {
  maintenanceUser(actor);
  const r = db.prepare(reportSelect + " WHERE r.id=?").get(id) as
    Report | undefined;
  assert(
    r && (actor.role === "warden" || r.creator_id === actor.id),
    404,
    "Report not found.",
  );
  return presentReport(r);
}
export function reportWhere(actor: User, p: URLSearchParams) {
  maintenanceUser(actor);
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (actor.role === "student") {
    clauses.push("r.creator_id=?");
    values.push(actor.id);
  }
  for (const [param, col] of [
    ["block", "b.id"],
    ["level", "l.id"],
    ["room", "rm.id"],
    ["category", "r.category"],
    ["student", "r.creator_id"],
  ] as const)
    if (p.get(param)) {
      clauses.push(`${col}=?`);
      values.push(p.get(param)!);
    }
  if (p.get("status") === "Open") clauses.push("r.status!='Closed'");
  else if (p.get("status")) {
    clauses.push("r.status=?");
    values.push(p.get("status")!);
  }
  if (p.get("q")) {
    clauses.push("(r.report_number LIKE ? OR r.title LIKE ?)");
    values.push(`%${p.get("q")}%`, `%${p.get("q")}%`);
  }
  return {
    sql: clauses.length ? " WHERE " + clauses.join(" AND ") : "",
    values,
  };
}
export function listReports(db: DB, actor: User, p: URLSearchParams) {
  const w = reportWhere(actor, p),
    page = Math.max(1, Math.min(100000, Number(p.get("page")) || 1)),
    size = 20;
  const total = (
    db
      .prepare(`SELECT COUNT(*) n FROM (${reportSelect + w.sql})`)
      .get(...w.values) as { n: number }
  ).n;
  const rows = db
    .prepare(
      reportSelect +
        w.sql +
        " ORDER BY r.created_at DESC,r.id LIMIT ? OFFSET ?",
    )
    .all(...w.values, size, (page - 1) * size) as Report[];
  return {
    items: rows.map((r) => ({
      ...presentReport(r),
      latest_message: (
        db
          .prepare(
            "SELECT message FROM events WHERE report_id=? ORDER BY seq DESC LIMIT 1",
          )
          .get(r.id) as { message: string }
      )?.message,
    })),
    total,
    page,
    pages: Math.ceil(total / size),
  };
}
export function attach(db: DB, actor: User, eventId: string, ids: string[]) {
  for (const id of ids) {
    const photo = db
      .prepare(
        "SELECT u.* FROM uploads u LEFT JOIN attachments a ON a.id=u.id WHERE u.id=? AND u.owner_id=? AND a.id IS NULL AND u.created_at>?",
      )
      .get(id, actor.id, new Date(Date.now() - 86400000).toISOString());
    assert(
      photo,
      400,
      "A photo expired or is already attached. Please upload it again.",
    );
    db.prepare("INSERT INTO attachments VALUES (?,?)").run(id, eventId);
  }
}
function notify(
  db: DB,
  actor: User,
  report: Report | { creator_id: string },
  eventId: string,
  time: string,
) {
  const users =
    actor.role === "student"
      ? (db
          .prepare("SELECT id FROM users WHERE role='warden' AND active=1")
          .all() as { id: string }[])
      : [{ id: report.creator_id }];
  for (const u of users)
    db.prepare(
      "INSERT INTO notifications(id,recipient_id,event_id,created_at) VALUES (?,?,?,?)",
    ).run(uid(), u.id, eventId, time);
}
function insertEvent(
  db: DB,
  reportId: string,
  actor: User,
  kind: string,
  message: string,
  prev: string | null,
  next: string | null,
  time: string,
  submission: string,
) {
  const id = uid();
  db.prepare(
    "INSERT INTO events(id,seq,report_id,actor_id,kind,message,previous_status,new_status,created_at,submission_key) VALUES (?,(SELECT COALESCE(MAX(seq),0)+1 FROM events),?,?,?,?,?,?,?,?)",
  ).run(id, reportId, actor.id, kind, message, prev, next, time, submission);
  return id;
}
export function createReport(db: DB, actor: User, input: unknown) {
  const d = newReportSchema.parse(input);
  assert(actor.role === "student", 403, "Student access required.");
  return db
    .transaction(() => {
      activeActor(db, actor);
      const existing = db
        .prepare(
          "SELECT id FROM reports WHERE creator_id=? AND submission_key=?",
        )
        .get(actor.id, d.submission_key) as { id: string } | undefined;
      if (existing) return existing;
      consume(db, actor, "reports");
      const room = availableRoom(db, d.room_id);
      assert(room, 400, "This room is no longer available.");
      db.prepare(
        "INSERT OR IGNORE INTO report_counters(level_id,value) VALUES (?,0)",
      ).run(room.level_id);
      let n = (
        db
          .prepare("SELECT value FROM report_counters WHERE level_id=?")
          .get(room.level_id) as { value: number }
      ).value;
      let number: string;
      do {
        n++;
        number = `${room.block_code}-${room.level_code}-${String(n).padStart(5, "0")}`;
      } while (
        db.prepare("SELECT id FROM reports WHERE report_number=?").get(number)
      );
      db.prepare("UPDATE report_counters SET value=? WHERE level_id=?").run(
        n,
        room.level_id,
      );
      const id = uid(),
        time = now();
      db.prepare(
        "INSERT INTO reports(id,report_number,creator_id,room_id,title,description,category,status,created_at,updated_at,submission_key) VALUES (?,?,?,?,?,?,?,'Submitted',?,?,?)",
      ).run(
        id,
        number,
        actor.id,
        d.room_id,
        d.title,
        d.description,
        d.category,
        time,
        time,
        d.submission_key,
      );
      const event = insertEvent(
        db,
        id,
        actor,
        "Submitted",
        d.description,
        null,
        "Submitted",
        time,
        d.submission_key,
      );
      attach(db, actor, event, d.photos);
      notify(db, actor, { creator_id: actor.id }, event, time);
      return { id };
    })
    .immediate();
}
export function addEvent(db: DB, actor: User, id: string, input: unknown) {
  const d = eventSchema.parse(input);
  return db
    .transaction(() => {
      activeActor(db, actor);
      const r = getReport(db, actor, id);
      const prior = db
        .prepare(
          "SELECT id,report_id FROM events WHERE actor_id=? AND submission_key=?",
        )
        .get(actor.id, d.submission_key) as
        { id: string; report_id: string } | undefined;
      if (prior) {
        assert(prior.report_id === id, 409, "Submission key already used.");
        return { id: prior.id };
      }
      assert(
        r.status !== "Closed",
        409,
        "This report is closed and permanently read-only.",
      );
      if (d.status) {
        warden(actor);
        assert(
          d.expected_status === r.status,
          409,
          "Another warden changed the status. Refresh before continuing.",
        );
        assert(
          STATUSES.indexOf(d.status) > STATUSES.indexOf(r.status),
          400,
          "Invalid status transition.",
        );
      }
      consume(db, actor, "events");
      const time = now(),
        event = insertEvent(
          db,
          id,
          actor,
          d.status ? "Status change" : "Reply",
          d.message,
          d.status ? r.status : null,
          d.status || null,
          time,
          d.submission_key,
        );
      attach(db, actor, event, d.photos);
      notify(db, actor, r, event, time);
      if (d.status === "Closed") {
        const authors = db
          .prepare(
            "SELECT DISTINCT u.id,u.name FROM events e JOIN users u ON u.id=e.actor_id WHERE e.report_id=?",
          )
          .all(id) as { id: string; name: string }[];
        const snapshot = JSON.stringify({
          location: r.location,
          creator_name: r.creator_name,
          authors: Object.fromEntries(authors.map((a) => [a.id, a.name])),
        });
        db.prepare(
          "UPDATE reports SET status='Closed',updated_at=?,closed_at=?,closed_by=?,snapshot=? WHERE id=?",
        ).run(time, time, actor.id, snapshot, id);
      } else
        db.prepare("UPDATE reports SET status=?,updated_at=? WHERE id=?").run(
          d.status || r.status,
          time,
          id,
        );
      return { id: event };
    })
    .immediate();
}
export function timeline(db: DB, actor: User, id: string, page = 1) {
  const report = getReport(db, actor, id);
  const snapshot = report.snapshot ? JSON.parse(report.snapshot) : null;
  const events = db
    .prepare(
      "SELECT e.*,u.name actor_name,u.role actor_role FROM events e JOIN users u ON u.id=e.actor_id WHERE report_id=? ORDER BY seq LIMIT 20 OFFSET ?",
    )
    .all(id, (Math.max(1, page) - 1) * 20) as TimelineEvent[];
  for (const e of events) {
    e.actor_name = snapshot?.authors[e.actor_id] || e.actor_name;
    e.attachments = db
      .prepare(
        "SELECT a.id,u.width,u.height,u.bytes FROM attachments a JOIN uploads u ON u.id=a.id WHERE a.event_id=?",
      )
      .all(e.id) as TimelineEvent["attachments"];
  }
  const total = (
    db.prepare("SELECT COUNT(*) n FROM events WHERE report_id=?").get(id) as {
      n: number;
    }
  ).n;
  return { report, events, total, pages: Math.ceil(total / 20) };
}
