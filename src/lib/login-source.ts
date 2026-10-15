import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { securityConfig } from "./security-config";
import { assert } from "./service";
export function loginSource(headers: Headers) {
  const { production } = securityConfig();
  if (!production && process.env.TRUSTED_PROXY_MODE !== "traefik-isolated")
    return "local-development";
  const supplied = Buffer.from(headers.get("x-paini-proxy-secret") || "");
  const expected = Buffer.from(process.env.PROXY_SHARED_SECRET || "");
  assert(
    expected.length >= 64 &&
      supplied.length === expected.length &&
      timingSafeEqual(supplied, expected),
    403,
    "Request source is not allowed.",
  );
  // The isolated Traefik ingress must overwrite X-Real-IP with its direct peer.
  const ip = headers.get("x-real-ip") || "";
  assert(isIP(ip) && !ip.includes("%"), 403, "Request source is not allowed.");
  const canonical = isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip;
  return createHmac("sha256", process.env.LOGIN_IDENTIFIER_KEY!)
    .update(canonical)
    .digest("hex");
}
