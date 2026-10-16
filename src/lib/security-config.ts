import { LIMIT_DEFINITIONS } from "./limit-definitions";
export function securityConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const raw = env.APP_ORIGIN || (production ? "" : "http://localhost:3000");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("APP_ORIGIN must be an exact public origin.");
  }
  if (
    raw !== url.origin ||
    url.username ||
    url.password ||
    raw.includes("*") ||
    (production
      ? url.protocol !== "https:"
      : !["http:", "https:"].includes(url.protocol))
  )
    throw new Error("APP_ORIGIN must be an exact HTTPS production origin.");
  for (const [key, value] of Object.entries(env)) {
    if (
      (key.startsWith("QUOTA_") ||
        [
          "LOGIN_SOURCE_LIMIT",
          "LOGIN_ACCOUNT_SOURCE_LIMIT",
          "LOGIN_CONCURRENCY",
          "LOGIN_GLOBAL_LIMIT",
          "LOGIN_UNKNOWN_SOURCE_LIMIT",
        ].includes(key)) &&
      (!/^[1-9][0-9]*$/.test(value || "") ||
        !Number.isSafeInteger(Number(value)))
    )
      throw new Error(`Invalid limit: ${key}`);
  }
  for (const definition of LIMIT_DEFINITIONS) {
    const value = env[definition.key];
    if (
      value !== undefined &&
      (!/^[1-9][0-9]*$/.test(value) ||
        Number(value) < definition.min ||
        Number(value) > definition.max)
    )
      throw new Error(`Invalid limit: ${definition.key}`);
  }
  return { production, origin: url.origin };
}
export function limit(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(`Invalid limit: ${name}`);
  return Number(value);
}

export function sessionCookieOptions(hasToken: boolean) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      securityConfig().origin.startsWith("https://"),
    path: "/",
    maxAge: hasToken ? 86400 : 0,
  };
}
