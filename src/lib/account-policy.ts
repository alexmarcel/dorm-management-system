import type { DB } from "./db";
/** Read inside account write transactions to serialize policy changes with creation/reset. */
export function initialPasswordChange(db: DB): number {
  const setting = db
    .prepare(
      "SELECT value FROM app_settings WHERE key='require_initial_password_change'",
    )
    .get() as { value: number } | undefined;
  return setting?.value ?? 1;
}
