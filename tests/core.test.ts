import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../src/lib/db";
import {
  createReport,
  addEvent,
  getReport,
  timeline,
  listReports,
  saveLocation,
  uid,
  now,
  locations,
} from "../src/lib/service";
import { dashboard } from "../src/lib/dashboard";
import {
  login,
  passwordHash,
  sessionUser,
  changePassword,
} from "../src/lib/auth";
import { validatePhoto } from "../src/lib/storage";
import { type User } from "../src/lib/constants";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const runFile = promisify(execFile);

test("separate SQLite processes preserve concurrent replies and serialize closure", async () => {
  const f = fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "paini-concurrency-"));
  const file = path.join(directory, "shared.db");
  try {
    const r = createReport(f.db, f.a, f.draft());
    await f.db.backup(file);
    const run = async (
      user: string,
      mode: string,
      start: number,
      timeout = "5000",
    ) =>
      JSON.parse(
        (
          await runFile(process.execPath, [
            "--import",
            "tsx",
            "tests/helpers/mutate.ts",
            file,
            user,
            r.id,
            mode,
            String(start),
            timeout,
          ])
        ).stdout,
      ) as { ok: boolean; status?: number; code?: string };
    let start = Date.now() + 1500;
    const replies = await Promise.all([
      run(f.w.id, "reply", start),
      run(f.w2.id, "reply", start),
    ]);
    assert.ok(replies.every((x) => x.ok));
    const shared = openDatabase(file);
    try {
      assert.equal(timeline(shared, f.w, r.id).total, 3);
      start = Date.now() + 1500;
      const race = await Promise.all([
        run(f.w.id, "close", start),
        run(f.w2.id, "reply", start),
      ]);
      assert.equal(race[0].ok, true);
      assert.ok(race[1].ok || race[1].status === 409);
      const history = timeline(shared, f.w, r.id);
      assert.equal(history.events.at(-1)?.new_status, "Closed");
      assert.equal(history.report.status, "Closed");
      shared.exec("BEGIN IMMEDIATE");
      try {
        const busy = await run(f.w.id, "reply", Date.now(), "50");
        assert.equal(busy.code, "SQLITE_BUSY");
      } finally {
        shared.exec("ROLLBACK");
      }
    } finally {
      shared.close();
    }
  } finally {
    f.db.close();
  }
});

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  const user = (role: "student" | "warden", name: string) => {
    const id = uid();
    db.prepare(
      "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES (?,?,?,?,?,0,?)",
    ).run(id, name, name, "not-a-password", role, now());
    return db.prepare("SELECT * FROM users WHERE id=?").get(id) as User;
  };
  const w = user("warden", "warden"),
    w2 = user("warden", "warden2"),
    a = user("student", "alice"),
    b = user("student", "bob");
  const red = saveLocation(db, w, "blocks", {
      name: "Red block",
      code: "red",
    }).id,
    blue = saveLocation(db, w, "blocks", {
      name: "Blue block",
      code: "blue",
    }).id;
  const ground = saveLocation(db, w, "levels", {
      name: "Ground floor",
      code: "g",
      parent_id: red,
    }).id,
    upper = saveLocation(db, w, "levels", {
      name: "First floor",
      code: "1",
      parent_id: red,
    }).id,
    blueGround = saveLocation(db, w, "levels", {
      name: "Ground floor",
      code: "g",
      parent_id: blue,
    }).id;
  const room = saveLocation(db, w, "rooms", {
      name: "01",
      parent_id: ground,
    }).id,
    room2 = saveLocation(db, w, "rooms", { name: "02", parent_id: ground }).id,
    room3 = saveLocation(db, w, "rooms", { name: "01", parent_id: upper }).id,
    room4 = saveLocation(db, w, "rooms", {
      name: "01",
      parent_id: blueGround,
    }).id;
  const draft = (room_id = room) => ({
    room_id,
    title: "Broken lock",
    description: "The door cannot lock.",
    category: "Locks/doors",
    submission_key: uid(),
    photos: [],
  });
  return {
    db,
    w,
    w2,
    a,
    b,
    red,
    blue,
    ground,
    room,
    room2,
    room3,
    room4,
    draft,
  };
}
test("numbering is per level; IDs globally unique; retries do not allocate; overflow and rename remain stable", () => {
  const f = fixture();
  try {
    const d = f.draft(),
      one = createReport(f.db, f.a, d);
    assert.equal(createReport(f.db, f.a, d).id, one.id);
    const two = createReport(f.db, f.a, f.draft(f.room2)),
      three = createReport(f.db, f.a, f.draft(f.room3)),
      four = createReport(f.db, f.a, f.draft(f.room4));
    assert.equal(new Set([one.id, two.id, three.id, four.id]).size, 4);
    assert.deepEqual(
      [one, two, three, four].map(
        (x) => getReport(f.db, f.w, x.id).report_number,
      ),
      ["RED-G-00001", "RED-G-00002", "RED-1-00001", "BLUE-G-00001"],
    );
    saveLocation(f.db, f.w, "blocks", {
      id: f.red,
      name: "Ruby",
      code: "RUBY",
    });
    assert.equal(getReport(f.db, f.a, one.id).report_number, "RED-G-00001");
    f.db
      .prepare("UPDATE report_counters SET value=99999 WHERE level_id=?")
      .run(f.ground);
    assert.equal(
      getReport(f.db, f.w, createReport(f.db, f.a, f.draft()).id).report_number,
      "RUBY-G-100000",
    );
  } finally {
    f.db.close();
  }
});
test("students can report any room but cannot read others or aggregate their data", () => {
  const f = fixture();
  try {
    const a = createReport(f.db, f.a, f.draft()),
      b = createReport(f.db, f.b, f.draft());
    assert.throws(() => getReport(f.db, f.a, b.id), /not found/);
    assert.throws(() => timeline(f.db, f.b, a.id), /not found/);
    assert.equal(listReports(f.db, f.a, new URLSearchParams()).total, 1);
    assert.equal(dashboard(f.db, f.a, new URLSearchParams()).total, 1);
    assert.equal(dashboard(f.db, f.w, new URLSearchParams()).total, 2);
    assert.equal(dashboard(f.db, f.a, new URLSearchParams()).setup, undefined);
    assert.throws(
      () =>
        saveLocation(f.db, f.a, "blocks", { name: "Forbidden", code: "NO" }),
      /Warden/,
    );
  } finally {
    f.db.close();
  }
});
test("multiple wardens, stale status conflict, closure snapshots and direct SQL immutability", () => {
  const f = fixture();
  try {
    const r = createReport(f.db, f.a, f.draft());
    addEvent(f.db, f.w, r.id, {
      message: "Checking.",
      status: "Acknowledged",
      expected_status: "Submitted",
      submission_key: uid(),
    });
    assert.throws(
      () =>
        addEvent(f.db, f.w2, r.id, {
          message: "Working.",
          status: "In progress",
          expected_status: "Submitted",
          submission_key: uid(),
        }),
      /Another warden/,
    );
    addEvent(f.db, f.w2, r.id, {
      message: "Lock replaced.",
      status: "Closed",
      expected_status: "Acknowledged",
      submission_key: uid(),
    });
    assert.equal(getReport(f.db, f.a, r.id).closed_by, f.w2.id);
    assert.throws(
      () =>
        addEvent(f.db, f.a, r.id, { message: "Thanks", submission_key: uid() }),
      /closed/,
    );
    assert.throws(
      () =>
        addEvent(f.db, f.w, r.id, {
          message: "Reopen",
          status: "In progress",
          expected_status: "Closed",
          submission_key: uid(),
        }),
      /closed/,
    );
    f.db.prepare("UPDATE users SET name=? WHERE id=?").run("Renamed", f.w2.id);
    saveLocation(f.db, f.w, "blocks", {
      id: f.red,
      name: "New name",
      code: "NEW",
    });
    const result = timeline(f.db, f.a, r.id);
    assert.match(result.report.location, /Red block/);
    assert.equal(result.events.at(-1)?.actor_name, "warden2");
    assert.throws(
      () =>
        f.db.prepare("UPDATE reports SET title=? WHERE id=?").run("Edit", r.id),
      /immutable/,
    );
    assert.throws(
      () => f.db.prepare("DELETE FROM reports WHERE id=?").run(r.id),
      /immutable/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE events SET message=? WHERE report_id=?")
          .run("Edit", r.id),
      /append only/,
    );
    assert.throws(
      () =>
        f.db
          .prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(
            uid(),
            100,
            r.id,
            f.a.id,
            "Reply",
            "No",
            null,
            null,
            now(),
            uid(),
          ),
      /immutable/,
    );
  } finally {
    f.db.close();
  }
});
test("archival prevents reports, restoration respects independently archived descendants", () => {
  const f = fixture();
  try {
    const r = createReport(f.db, f.a, f.draft());
    saveLocation(f.db, f.w, "blocks", {
      id: f.red,
      name: "Red block",
      code: "RED",
      archived: true,
    });
    assert.throws(
      () => createReport(f.db, f.a, f.draft()),
      /no longer available/,
    );
    assert.ok(getReport(f.db, f.w, r.id));
    saveLocation(f.db, f.w, "rooms", {
      id: f.room,
      name: "01",
      archived: true,
    });
    saveLocation(f.db, f.w, "blocks", {
      id: f.red,
      name: "Red block",
      code: "RED",
      archived: false,
    });
    assert.equal(
      locations(f.db).rooms.find((r) => r.id === f.room)?.available,
      0,
    );
    assert.equal(
      locations(f.db).rooms.find((r) => r.id === f.room2)?.available,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("photo ownership, transactional rollback, immutable attachments", () => {
  const f = fixture();
  try {
    const photo = uid();
    f.db
      .prepare("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)")
      .run(photo, f.a.id, photo + ".webp", 100, 10, 10, now());
    assert.throws(
      () => createReport(f.db, f.b, { ...f.draft(), photos: [photo] }),
      /expired or is already/,
    );
    assert.equal(listReports(f.db, f.w, new URLSearchParams()).total, 0);
    const r = createReport(f.db, f.a, { ...f.draft(), photos: [photo] });
    assert.equal(getReport(f.db, f.a, r.id).report_number, "RED-G-00001");
    assert.equal(timeline(f.db, f.a, r.id).events[0].attachments.length, 1);
    assert.throws(
      () => f.db.prepare("DELETE FROM uploads WHERE id=?").run(photo),
      /immutable/,
    );
    addEvent(f.db, f.w, r.id, {
      message: "Done",
      status: "Closed",
      expected_status: "Submitted",
      submission_key: uid(),
    });
    assert.throws(
      () => f.db.prepare("DELETE FROM attachments WHERE id=?").run(photo),
      /immutable/,
    );
  } finally {
    f.db.close();
  }
});
test("notifications and metrics use reports not event counts, closure retries are idempotent", () => {
  const f = fixture();
  try {
    const r = createReport(f.db, f.a, f.draft());
    addEvent(f.db, f.w, r.id, { message: "Checking", submission_key: uid() });
    const closure = {
      message: "Fixed",
      status: "Closed",
      expected_status: "Submitted",
      submission_key: uid(),
    };
    const first = addEvent(f.db, f.w2, r.id, closure);
    assert.equal(addEvent(f.db, f.w2, r.id, closure).id, first.id);
    const d = dashboard(f.db, f.w, new URLSearchParams());
    assert.equal(d.total, 1);
    assert.equal(d.counts.Closed, 1);
    assert.equal(d.closedCount, 1);
    assert.equal(
      d.trend?.reduce((n, x) => n + x.closed, 0),
      1,
    );
    assert.equal(dashboard(f.db, f.a, new URLSearchParams()).unread, 2);
    assert.equal(dashboard(f.db, f.w, new URLSearchParams()).unread, 1);
  } finally {
    f.db.close();
  }
});
test("account login, password change, reset and deactivation invalidate access", async () => {
  const f = fixture();
  try {
    const hashed = await passwordHash("Temporary-pass-123");
    f.db
      .prepare("UPDATE users SET password_hash=?,must_change=1 WHERE id=?")
      .run(hashed, f.a.id);
    const signed = await login(f.db, "alice", "Temporary-pass-123");
    assert.equal(signed.user.must_change, 1);
    const token = await changePassword(
      f.db,
      signed.user,
      "Temporary-pass-123",
      "Changed-pass-456",
    );
    assert.equal(sessionUser(f.db, signed.token), null);
    assert.equal(sessionUser(f.db, token)?.must_change, 0);
    f.db.prepare("UPDATE users SET active=0 WHERE id=?").run(f.a.id);
    assert.equal(sessionUser(f.db, token), null);
    await assert.rejects(
      () => login(f.db, "alice", "Changed-pass-456"),
      /Invalid/,
    );
  } finally {
    f.db.close();
  }
});
test("server verifies WebP format, dimensions, byte limit and strips metadata", async () => {
  const input = await sharp({
    create: { width: 500, height: 400, channels: 3, background: "#abcdef" },
  })
    .webp()
    .withMetadata()
    .toBuffer();
  const result = await validatePhoto(input);
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.width, 500);
  await assert.rejects(() => validatePhoto(Buffer.alloc(500001)));
  const large = await sharp({
    create: { width: 1700, height: 100, channels: 3, background: "#000" },
  })
    .webp()
    .toBuffer();
  await assert.rejects(() => validatePhoto(large));
  const png = await sharp(input).png().toBuffer();
  await assert.rejects(() => validatePhoto(png));
});
test("migration replay and consistent backup preserve reports and guards", async () => {
  const f = fixture();
  const directory = mkdtempSync(path.join(tmpdir(), "paini-backup-"));
  try {
    migrate(f.db);
    const r = createReport(f.db, f.a, f.draft());
    addEvent(f.db, f.w, r.id, {
      message: "Done",
      status: "Closed",
      expected_status: "Submitted",
      submission_key: uid(),
    });
    const target = path.join(directory, "restored.db");
    await f.db.backup(target);
    const restored = openDatabase(target);
    try {
      assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(restored.pragma("foreign_key_check"), []);
      assert.equal(getReport(restored, f.a, r.id).status, "Closed");
      assert.throws(
        () => restored.prepare("DELETE FROM reports WHERE id=?").run(r.id),
        /immutable/,
      );
    } finally {
      restored.close();
    }
  } finally {
    f.db.close();
  }
});
