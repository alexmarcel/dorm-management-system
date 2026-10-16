import { configuredLimit, photoPolicy } from "@/lib/limit-settings";
import { consume, uploadQuota } from "@/lib/quotas";
import { securityConfig, sessionCookieOptions } from "@/lib/security-config";
import { loginSource } from "@/lib/login-source";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  COOKIE,
  login,
  sessionUser,
  tokenHash,
  changePassword,
  passwordHash,
} from "@/lib/auth";
import {
  AppError,
  assert,
  activeActor,
  warden,
  uid,
  now,
  locations,
  saveLocation,
  listReports,
  createReport,
  addEvent,
  timeline,
  getReport,
  studentSchema,
  userColumns,
  availableRoom,
  archiveStudent,
} from "@/lib/service";
import { dashboard } from "@/lib/dashboard";
import { validatePhoto, putPhoto, readPhoto, deletePhoto } from "@/lib/storage";
import type { User } from "@/lib/constants";
import { settingsApi } from "@/lib/settings-api";
import { initialPasswordChange } from "@/lib/account-policy";
import { enterRequest, leaveRequest } from "@/lib/control";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => {
  if (status >= 400 && data && typeof data === "object" && "error" in data)
    data = { code: (data as { error: string }).error, params: {}, ...data };
  return NextResponse.json(data, { status, headers });
};
function cookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE, token, sessionCookieOptions(Boolean(token)));
  return response;
}
async function body(req: NextRequest, max = 65536) {
  const reader = req.body?.getReader();
  assert(reader, 400, "Request body required.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > max) {
      await reader.cancel();
      throw new AppError(413, "Request is too large.");
    }
    parts.push(item.value);
  }
  return Buffer.concat(parts);
}
async function input(req: NextRequest) {
  try {
    return JSON.parse((await body(req)).toString());
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, "Invalid request.");
  }
}
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  let lease: string | null = null;
  let refund: (() => void) | undefined;
  try {
    const requested = (await context.params).path.join("/");
    if (requested === "health" && req.method === "GET") {
      getDb().prepare("SELECT 1 FROM users LIMIT 1").get();
      return json({ ok: true });
    }
    lease = enterRequest();
    assert(
      lease,
      503,
      "System maintenance is in progress. Please try again shortly.",
    );
    const parts = (await context.params).path,
      route = parts.join("/"),
      db = getDb(),
      method = req.method;
    if (method !== "GET") {
      const expected = securityConfig().origin;
      assert(
        req.headers.get("origin") === expected,
        403,
        "Request origin is not allowed.",
      );
    }
    if (route === "login" && method === "POST") {
      const d = z
        .object({ username: z.string().max(60), password: z.string().max(128) })
        .parse(await input(req));
      const result = await login(
        db,
        d.username,
        d.password,
        loginSource(req.headers),
      );
      return cookie(json({ user: result.user }), result.token);
    }
    const actor = sessionUser(db, req.cookies.get(COOKIE)?.value);
    assert(actor, 401, "Please sign in.");
    if (method !== "GET") {
      const reservation = db.transaction(() => {
        consume(db, actor, "mutations");
        return db.prepare(
          "SELECT reset_at FROM usage_limits WHERE user_id=? AND kind='mutations'",
        ).get(actor.id) as { reset_at: number };
      }).immediate();
      refund = () => {
        try {
          db.prepare(
            "UPDATE usage_limits SET used=MAX(0,used-1) WHERE user_id=? AND kind='mutations' AND reset_at=?",
          ).run(actor.id, reservation.reset_at);
        } catch {
          // A database outage must not replace a sanitized error with an uncaught
          // database error. The reservation expires with its existing quota window.
          console.error("PAINI quota refund unavailable.");
        }
      };
    }
    if (route === "logout" && method === "POST") {
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        tokenHash(req.cookies.get(COOKIE)!.value),
      );
      return cookie(json({ ok: true }), "");
    }
    if (route === "me" && method === "GET") return json({ user: actor });
    if (route === "password" && method === "POST") {
      const d = z
        .object({
          current: z.string().max(128),
          password: z.string().min(8).max(128),
        })
        .parse(await input(req));
      return cookie(
        json({ ok: true }),
        await changePassword(db, actor, d.current, d.password),
      );
    }
    assert(!actor.must_change, 403, "Change your password before continuing.");
    if (parts[0] === "settings") {
      const response = await settingsApi(req, db, actor, parts);
      if (response.status >= 400) refund?.();
      return response;
    }
    assert(
      actor.role === "warden" || actor.role === "student",
      403,
      "Maintenance access is not available to this account.",
    );
    if (route === "upload-policy" && method === "GET") return json(photoPolicy(db));
    if (route === "locations" && method === "GET") return json(locations(db));
    if (parts[0] === "locations" && parts.length === 2 && method === "POST")
      return json(saveLocation(db, actor, parts[1], await input(req)));
    if (route === "dashboard" && method === "GET")
      return json(dashboard(db, actor, req.nextUrl.searchParams));
    if (route === "reports" && method === "GET")
      return json(listReports(db, actor, req.nextUrl.searchParams));
    if (route === "reports" && method === "POST")
      return json(createReport(db, actor, await input(req)), 201);
    if (parts[0] === "reports" && parts.length === 2 && method === "GET")
      return json(
        timeline(
          db,
          actor,
          parts[1],
          Math.max(
            1,
            Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1),
          ),
        ),
      );
    if (
      parts[0] === "reports" &&
      parts[2] === "events" &&
      parts.length === 3 &&
      method === "POST"
    )
      return json(addEvent(db, actor, parts[1], await input(req)), 201);
    if (route === "uploads" && method === "POST") {
      assert(
        req.headers.get("content-type") === "image/webp",
        400,
        "A compressed WebP image is required.",
      );
      const pending = (
        db
          .prepare(
            "SELECT COUNT(*) n FROM uploads u LEFT JOIN attachments a ON a.id=u.id WHERE u.owner_id=? AND a.id IS NULL",
          )
          .get(actor.id) as { n: number }
      ).n;
      assert(
        pending < configuredLimit(db, "PHOTO_MAX_PENDING"),
        429,
        "Too many pending photos. Submit your current report or try again after cleanup.",
      );
      const policy = photoPolicy(db);
      const bytes = await body(req, policy.maxBytes);
      let photo;
      try {
        photo = await validatePhoto(bytes, policy);
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(400, "This image could not be decoded.");
      }
      const id = uid(),
        object_key = id + ".webp";
      await putPhoto(object_key, photo.bytes);
      try {
        db.transaction(() => {
          activeActor(db, actor);
          const currentPolicy = photoPolicy(db);
          assert(photo.bytes.length <= currentPolicy.maxBytes && bytes.length <= currentPolicy.maxBytes && photo.width <= currentPolicy.maxDimension && photo.height <= currentPolicy.maxDimension, 400, "Photo exceeds the current upload limits.");
          uploadQuota(db, actor, photo.bytes.length);
          db.prepare("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)").run(
            id,
            actor.id,
            object_key,
            photo.bytes.length,
            photo.width,
            photo.height,
            now(),
          );
          db.prepare("INSERT INTO upload_expirations(upload_id,expires_at) VALUES (?,?)").run(id, new Date(Date.now() + configuredLimit(db, "PHOTO_EXPIRY_HOURS") * 3600000).toISOString());
        }).immediate();
      } catch (e) {
        await deletePhoto(object_key);
        throw e;
      }
      return json(
        {
          id,
          width: photo.width,
          height: photo.height,
          bytes: photo.bytes.length,
        },
        201,
      );
    }
    if (parts[0] === "photos" && parts.length === 2 && method === "GET") {
      const upload = db
        .prepare(
          "SELECT u.object_key,e.report_id FROM uploads u JOIN attachments a ON a.id=u.id JOIN events e ON e.id=a.event_id WHERE u.id=?",
        )
        .get(parts[1]) as { object_key: string; report_id: string } | undefined;
      assert(upload, 404, "Photo not found.");
      getReport(db, actor, upload.report_id);
      return new NextResponse(
        new Uint8Array(await readPhoto(upload.object_key)),
        {
          headers: {
            ...headers,
            "Content-Type": "image/webp",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (route === "students/options" && method === "GET") {
      warden(actor);
      return json(
        db
          .prepare(
            "SELECT id,name,student_id FROM users WHERE role='student' ORDER BY name",
          )
          .all(),
      );
    }
    if (route === "students" && method === "GET") {
      warden(actor);
      const p = req.nextUrl.searchParams,
        clauses = ["u.role='student'",req.nextUrl.searchParams.get('active')==='archived'?'u.archived_at IS NOT NULL':'u.archived_at IS NULL'],
        values: (string | number)[] = [];
      if (p.get("q")) {
        clauses.push(
          "(u.name LIKE ? OR u.username LIKE ? OR u.student_id LIKE ?)",
        );
        values.push(...Array(3).fill(`%${p.get("q")}%`));
      }
      if (p.get("active") && p.get('active')!=='archived') {
        clauses.push("u.active=?");
        values.push(p.get("active") === "true" ? 1 : 0);
      }
      for (const [key, column] of [
        ["block", "l.block_id"],
        ["level", "r.level_id"],
        ["room", "u.room_id"],
      ])
        if (p.get(key)) {
          clauses.push(`${column}=?`);
          values.push(p.get(key)!);
        }
      const sql = ` FROM users u LEFT JOIN rooms r ON r.id=u.room_id LEFT JOIN levels l ON l.id=r.level_id WHERE ${clauses.join(" AND ")}`;
      const page = Math.max(1, Number(p.get("page")) || 1),
        total = (
          db.prepare("SELECT COUNT(*) n" + sql).get(...values) as { n: number }
        ).n;
      return json({
        items: db
          .prepare(
            "SELECT " +
              userColumns
                .split(",")
                .map((c) => "u." + c)
                .join(",") +
              sql +
              " ORDER BY u.name LIMIT 20 OFFSET ?",
          )
          .all(...values, (page - 1) * 20),
        total,
        page,
        pages: Math.ceil(total / 20),
      });
    }
    if (parts[0] === "students" && method === "POST" && parts.length <= 2) {
      warden(actor);
      const raw = await input(req);
      if(parts[1]&&(raw.action==='archive'||raw.action==='restore'))return json(archiveStudent(db,actor,parts[1],raw.action==='archive'));
      if (parts[1] && raw.action === "reset") {
        const hashed = await passwordHash(
          z.string().min(8).max(128).parse(raw.password),
        );
        db.transaction(() => {
          warden(activeActor(db, actor));
          const result = db
            .prepare(
              "UPDATE users SET password_hash=?,must_change=? WHERE id=? AND role='student' AND archived_at IS NULL",
            )
            .run(hashed, initialPasswordChange(db), parts[1]);
          assert(result.changes, 404, "Student not found.");
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(parts[1]);
        }).immediate();
        return json({ ok: true });
      }
      const d = studentSchema.parse(raw);
      assert(parts[1] || d.password, 400, "Initial password is required.");
      const hashed = d.password ? await passwordHash(d.password) : null;
      const id = db
        .transaction(() => {
          warden(activeActor(db, actor));
          const id = parts[1] || uid();
          const existing = parts[1]
            ? (db
                .prepare(
                  "SELECT room_id FROM users WHERE id=? AND role='student' AND archived_at IS NULL",
                )
                .get(id) as { room_id: string | null } | undefined)
            : undefined;
          if (parts[1]) assert(existing, 404, "Student not found.");
          if (d.room_id && d.room_id !== existing?.room_id)
            assert(availableRoom(db, d.room_id), 400, "Select an active room.");
          if (parts[1]) {
            db.prepare(
              "UPDATE users SET name=?,username=?,student_id=?,room_id=?,active=?,phone=?,email=? WHERE id=? AND role='student'",
            ).run(
              d.name,
              d.username,
              d.student_id,
              d.room_id,
              +d.active,
              d.phone || null,
              d.email || null,
              id,
            );
            if (!d.active)
              db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
          } else
            db.prepare(
              "INSERT INTO users(id,name,username,password_hash,role,student_id,room_id,active,created_at,phone,email,must_change) VALUES (?,?,?,?,'student',?,?,?,?,?,?,?)",
            ).run(
              id,
              d.name,
              d.username,
              hashed,
              d.student_id,
              d.room_id,
              +d.active,
              now(),
              d.phone || null,
              d.email || null,
              initialPasswordChange(db),
            );
          return id;
        })
        .immediate();
      return json({ id });
    }
    if (route === "notifications" && method === "GET") {
      const page = Math.max(
        1,
        Number(req.nextUrl.searchParams.get("page")) || 1,
      );
      const items = db
        .prepare(
          "SELECT n.*,e.report_id,e.message,e.kind,r.report_number FROM notifications n JOIN events e ON e.id=n.event_id JOIN reports r ON r.id=e.report_id WHERE n.recipient_id=? ORDER BY n.created_at DESC,n.id LIMIT 20 OFFSET ?",
        )
        .all(actor.id, (page - 1) * 20);
      const total = (
        db
          .prepare("SELECT COUNT(*) n FROM notifications WHERE recipient_id=?")
          .get(actor.id) as { n: number }
      ).n;
      const unread = (
        db
          .prepare(
            "SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND read_at IS NULL",
          )
          .get(actor.id) as { n: number }
      ).n;
      return json({ items, total, unread, page, pages: Math.ceil(total / 20) });
    }
    if (
      parts[0] === "notifications" &&
      parts.length === 2 &&
      method === "POST"
    ) {
      const result = db
        .prepare(
          "UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient_id=?",
        )
        .run(now(), parts[1], actor.id);
      assert(result.changes, 404, "Notification not found.");
      return json({ ok: true });
    }
    throw new AppError(404, "Not found.");
  } catch (error) {
    refund?.();
    if (error instanceof AppError)
      return json(
        { error: error.message, code: error.code, params: {} },
        error.status,
      );
    if (error instanceof z.ZodError)
      return json(
        {
          code: "validation_failed",
          params: { fields: error.issues.map((i) => i.path.join(".")) },
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    const code = (error as { code?: string }).code || "";
    if (code.startsWith("SQLITE_CONSTRAINT"))
      return json(
        {
          error:
            "That name, code, username, student ID, or submission already exists, or the record cannot be changed.",
        },
        409,
      );
    if (code === "SQLITE_BUSY")
      return json(
        {
          error:
            "The database is busy. Your changes were not saved. Please retry.",
        },
        503,
      );
    console.error("PAINI request failed:", (error as Error).name, code);
    return json({ error: "Something went wrong. Please try again." }, 500);
  } finally {
    if (lease) leaveRequest(lease);
  }
}
export { handle as GET, handle as POST };
