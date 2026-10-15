import type { DB } from "./db";
import type { User } from "./constants";
import { assert } from "./service";
import { limit } from "./security-config";
const defaults = {
  mutations: [60, 300],
  uploads: [20, 60],
  bytes: [10000000, 50000000],
  reports: [10, 10],
  events: [50, 300],
  retained: [100000000, 500000000],
} as const;
export function quotaLimit(actor: User, kind: keyof typeof defaults) {
  return limit(
    `QUOTA_${actor.role.toUpperCase()}_${kind.toUpperCase()}`,
    defaults[kind][actor.role === "student" ? 0 : 1],
  );
}
// Call within the mutation's IMMEDIATE transaction. Failed mutations roll back usage.
export function consume(
  db: DB,
  actor: User,
  kind: Exclude<keyof typeof defaults, "retained">,
  amount = 1,
) {
  assert(db.inTransaction, 500, "Quota transaction required.");
  const time = Date.now(),
    window = kind === "mutations" || kind === "uploads" ? 60000 : 86400000;
  db.prepare("DELETE FROM usage_limits WHERE reset_at<=?").run(time);
  const row = db
    .prepare("SELECT used FROM usage_limits WHERE user_id=? AND kind=?")
    .get(actor.id, kind) as { used: number } | undefined;
  assert(
    (row?.used || 0) + amount <= quotaLimit(actor, kind),
    429,
    "Usage limit reached. Try again later.",
  );
  db.prepare(
    "INSERT INTO usage_limits VALUES (?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET used=used+excluded.used",
  ).run(actor.id, kind, time + window, amount);
}
export function uploadQuota(db: DB, actor: User, bytes: number) {
  consume(db, actor, "uploads");
  consume(db, actor, "bytes", bytes);
  const retained = db
    .prepare("SELECT COALESCE(SUM(bytes),0) n FROM uploads WHERE owner_id=?")
    .get(actor.id) as { n: number };
  assert(
    retained.n + bytes <= quotaLimit(actor, "retained"),
    413,
    "Photo storage quota exhausted.",
  );
  const pending = db
    .prepare(
      "SELECT COUNT(*) n FROM uploads u WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.id=u.id)",
    )
    .get(actor.id) as { n: number };
  assert(pending.n < 50, 429, "Too many pending photos.");
}
