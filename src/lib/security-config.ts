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
  if (
    production &&
    (env.TRUSTED_PROXY_MODE !== "traefik-isolated" ||
      !/^[a-f0-9]{64,}$/.test(env.PROXY_SHARED_SECRET || "") ||
      !/^[a-f0-9]{64,}$/.test(env.LOGIN_IDENTIFIER_KEY || ""))
  )
    throw new Error(
      "Configure isolated Traefik and independent proxy/login secrets.",
    );
  if (production && env.PROXY_SHARED_SECRET === env.LOGIN_IDENTIFIER_KEY)
    throw new Error("Proxy and identifier secrets must differ.");
  for (const [key, value] of Object.entries(env)) {
    if (
      (key.startsWith("QUOTA_") ||
        [
          "LOGIN_SOURCE_LIMIT",
          "LOGIN_ACCOUNT_SOURCE_LIMIT",
          "LOGIN_CONCURRENCY",
        ].includes(key)) &&
      (!/^[1-9][0-9]*$/.test(value || "") ||
        !Number.isSafeInteger(Number(value)))
    )
      throw new Error(`Invalid limit: ${key}`);
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
