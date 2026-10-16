import { createHash } from "node:crypto";
import type { DB } from "./db";
import type { User } from "./constants";
import {
  LIMIT_DEFINITIONS,
  type LimitSnapshot,
  type PhotoPolicy,
} from "./limit-definitions";
import { limit } from "./security-config";
import { assert, activeActor } from "./service";
import { audit, superadmin } from "./admin";

export function configuredLimit(db: DB, key: string): number {
  const definition = LIMIT_DEFINITIONS.find((d) => d.key === key);
  if (!definition) throw new Error("Unknown limit setting.");
  const row = db
    .prepare("SELECT value FROM limit_settings WHERE key=?")
    .get(key) as { value: number } | undefined;
  const value = row?.value ?? limit(key, definition.defaultValue);
  assert(
    Number.isSafeInteger(value) &&
      value >= definition.min &&
      value <= definition.max,
    500,
    "Limit configuration is invalid.",
  );
  return value;
}
export function limitSnapshot(db: DB): LimitSnapshot {
  return db
    .transaction(() => {
      const values = Object.fromEntries(
        LIMIT_DEFINITIONS.map((d) => [d.key, configuredLimit(db, d.key)]),
      );
      return {
        values,
        defaults: Object.fromEntries(
          LIMIT_DEFINITIONS.map((d) => [d.key, d.defaultValue]),
        ),
        revision: createHash("sha256")
          .update(JSON.stringify(values))
          .digest("hex"),
      };
    })
    .deferred();
}
export function saveLimits(db: DB, actor: User, input: unknown): LimitSnapshot {
  superadmin(actor); // Authorization precedes payload validation.
  return db
    .transaction(() => {
      superadmin(activeActor(db, actor));
      const d = input as {
        values?: Record<string, unknown>;
        revision?: unknown;
      } | null;
      assert(
        d &&
          typeof d === "object" &&
          typeof d.revision === "string" &&
          d.values &&
          typeof d.values === "object" &&
          !Array.isArray(d.values),
        400,
        "Invalid limit settings.",
      );
      assert(
        Object.keys(d).every((k) => k === "values" || k === "revision") &&
          Object.keys(d.values).length === LIMIT_DEFINITIONS.length,
        400,
        "Invalid limit settings.",
      );
      for (const definition of LIMIT_DEFINITIONS) {
        const value = d.values[definition.key];
        assert(
          typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= definition.min &&
            value <= definition.max,
          400,
          "Limit values must be whole numbers within the allowed range.",
        );
      }
      const before = limitSnapshot(db);
      assert(
        d.revision === before.revision,
        409,
        "Limits changed. Reload the saved values before saving again.",
      );
      for (const definition of LIMIT_DEFINITIONS)
        db.prepare(
          "INSERT INTO limit_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).run(definition.key, d.values[definition.key]);
      audit(db, actor, "settings.limits", null, {
        before: before.values,
        after: d.values,
      });
      return limitSnapshot(db);
    })
    .immediate();
}
export function photoPolicy(db: DB): PhotoPolicy {
  return {
    maxBytes: configuredLimit(db, "PHOTO_MAX_BYTES"),
    maxDimension: configuredLimit(db, "PHOTO_MAX_DIMENSION"),
    maxAttachments: configuredLimit(db, "PHOTO_MAX_ATTACHMENTS"),
  };
}
export const uploadExpirySql =
  "COALESCE(x.expires_at,strftime('%Y-%m-%dT%H:%M:%fZ',u.created_at,'+24 hours'))";
