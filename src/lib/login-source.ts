import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { loginIdentifierKey } from "./login-identity";

export const UNKNOWN_SOURCE = "unknown-source";

function address(value: string): string | undefined {
  const candidate = value.trim();
  // Scope IDs and port/bracket syntax are not client-address identifiers.
  const version = isIP(candidate);
  if (!version || candidate.includes("%")) return undefined;
  return version === 6 ? new URL(`http://[${candidate}]/`).hostname : candidate;
}

// These headers are supplementary, not authenticated. Global rate/concurrency
// limits must remain effective even when clients forge or rotate every header.
export function loginSource(headers: Headers, identifierKey?: Buffer): string {
  let ip = address(headers.get("x-real-ip") || "");
  if (!ip) {
    // Use the rightmost valid X-Forwarded-For hop, closest to the application.
    const chain = (headers.get("x-forwarded-for") || "").split(",");
    for (let i = chain.length - 1; i >= 0 && !ip; i--) ip = address(chain[i]);
  }
  if (!ip) return UNKNOWN_SOURCE;
  return createHmac("sha256", identifierKey ?? loginIdentifierKey())
    .update(ip)
    .digest("hex");
}
