import type { DB } from "./db";
import type { User } from "./constants";
import { assert } from "./service";
import { configuredLimit } from "./limit-settings";
type QuotaKind =
  "mutations" | "uploads" | "bytes" | "reports" | "events" | "retained";
export function quotaLimit(db: DB, actor: User, kind: QuotaKind) {
  return configuredLimit(
    db,
    `QUOTA_${actor.role.toUpperCase()}_${kind.toUpperCase()}`,
  );
}
// Call within the mutation's IMMEDIATE transaction. Failed mutations roll back usage.
export function consume(
  db: DB,
  actor: User,
  kind: Exclude<QuotaKind, "retained">,
  amount = 1,
) {
  assert(db.inTransaction, 500, "Quota transaction required.");
  const time = Date.now(),
    window =
      kind === "mutations" || kind === "uploads"
        ? configuredLimit(db, "QUOTA_SHORT_WINDOW_SECONDS") * 1000
        : configuredLimit(db, "QUOTA_DAILY_WINDOW_HOURS") * 3600000;
  db.prepare("DELETE FROM usage_limits WHERE reset_at<=?").run(time);
  const row = db
    .prepare("SELECT used FROM usage_limits WHERE user_id=? AND kind=?")
    .get(actor.id, kind) as { used: number } | undefined;
  assert(
    (row?.used || 0) + amount <= quotaLimit(db, actor, kind),
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
    retained.n + bytes <= quotaLimit(db, actor, "retained"),
    413,
    "Photo storage quota exhausted.",
  );
  const pending = db
    .prepare(
      "SELECT COUNT(*) n FROM uploads u WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.id=u.id)",
    )
    .get(actor.id) as { n: number };
  assert(
    pending.n < configuredLimit(db, "PHOTO_MAX_PENDING"),
    429,
    "Too many pending photos.",
  );
}
