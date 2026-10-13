import type { DB } from "./db";
import { type User, type Report, STATUSES } from "./constants";
import { reportSelect, reportWhere, presentReport, locations } from "./service";
function day(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}
export function dashboard(db: DB, actor: User, p: URLSearchParams) {
  const filter = new URLSearchParams();
  for (const key of ["block", "level", "room"])
    if (p.get(key)) filter.set(key, p.get(key)!);
  const w = reportWhere(actor, filter);
  const reports = (
    db
      .prepare(reportSelect + w.sql + " ORDER BY r.created_at,r.id")
      .all(...w.values) as Report[]
  ).map(presentReport);
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, reports.filter((r) => r.status === s).length]),
  );
  const open = reports.filter((r) => r.status !== "Closed");
  const eventRows = db
    .prepare(
      `SELECT e.*,u.name actor_name,u.role actor_role,r.report_number,r.snapshot, b.name||' / '||l.name||' / '||rm.name location FROM events e JOIN users u ON u.id=e.actor_id JOIN reports r ON r.id=e.report_id JOIN rooms rm ON rm.id=r.room_id JOIN levels l ON l.id=rm.level_id JOIN blocks b ON b.id=l.block_id ${w.sql}${actor.role === "student" ? (w.sql ? " AND " : " WHERE ") + "u.role='warden'" : ""} ORDER BY e.seq DESC LIMIT ?`,
    )
    .all(...w.values, actor.role === "student" ? 5 : 10) as {
    id: string;
    report_id: string;
    actor_id: string;
    actor_name: string;
    actor_role: string;
    message: string;
    created_at: string;
    report_number: string;
    location: string;
    snapshot: string | null;
  }[];
  const activity = eventRows.map((e) => {
    if (!e.snapshot) return e;
    const snap = JSON.parse(e.snapshot);
    return {
      ...e,
      actor_name: snap.authors[e.actor_id] || e.actor_name,
      location: snap.location,
    };
  });
  const today = day(new Date().toISOString()),
    start = new Date(today + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - 29);
  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const label = d.toISOString().slice(0, 10);
    return {
      day: label,
      submitted: reports.filter((r) => day(r.created_at) === label).length,
      closed: reports.filter((r) => r.closed_at && day(r.closed_at) === label)
        .length,
    };
  });
  const closed = reports.filter(
    (r) =>
      r.closed_at &&
      day(r.closed_at) >= trend[0].day &&
      day(r.closed_at) <= today,
  );
  const allLocations = locations(db);
  return {
    total: reports.length,
    counts,
    attention: open.filter((r) => r.status === "Submitted").slice(0, 5),
    oldest: open.slice(0, 5),
    recent: open
      .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, 5),
    activity,
    unread: (
      db
        .prepare(
          "SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND read_at IS NULL",
        )
        .get(actor.id) as { n: number }
    ).n,
    assigned_room:
      allLocations.rooms.find((r) => r.id === actor.room_id)?.label || null,
    ...(actor.role === "warden"
      ? {
          trend,
          averageHours: closed.length
            ? closed.reduce(
                (sum, r) =>
                  sum +
                  (Date.parse(r.closed_at!) - Date.parse(r.created_at)) /
                    3600000,
                0,
              ) / closed.length
            : null,
          closedCount: closed.length,
          byBlock: allLocations.blocks.map((b) => ({
            id: b.id,
            name: b.name,
            count: open.filter((r) => r.block_id === b.id).length,
          })),
          byCategory: [...new Set(reports.map((r) => r.category))].map((c) => ({
            name: c,
            count: open.filter((r) => r.category === c).length,
          })),
          setup: {
            students: (
              db
                .prepare(
                  "SELECT COUNT(*) n FROM users WHERE role='student' AND active=1",
                )
                .get() as { n: number }
            ).n,
            blocks: allLocations.blocks.filter((b) => !b.archived).length,
            levels: allLocations.levels.filter(
              (l) =>
                !l.archived &&
                !allLocations.blocks.find((b) => b.id === l.block_id)?.archived,
            ).length,
            rooms: allLocations.rooms.filter((r) => r.available).length,
          },
        }
      : {}),
    refreshed_at: new Date().toISOString(),
  };
}
