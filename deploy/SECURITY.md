# Security deployment requirements

Production requires APP_ORIGIN, TRUSTED_PROXY_MODE=traefik-isolated,
PROXY_SHARED_SECRET and LOGIN_IDENTIFIER_KEY. Use an exact HTTPS origin such as
https://paini.example.invalid (placeholder, no slash/path/query/credentials).
Generate two independent secrets with `openssl rand -hex 32`. Keep them out of
source control and access logs. Startup rejects missing or malformed values.
NODE_ENV=production always produces Secure, HttpOnly, SameSite=Strict, Path=/
session cookies with the existing 24-hour lifetime. Development alone defaults to
http://localhost:3000; specify APP_ORIGIN explicitly for another local port.

## Traefik trust boundary

The supported topology is Internet -> TLS Traefik -> isolated PAINI backend on
one host. Bind the app to loopback (`npm start -- --hostname 127.0.0.1`) when
Traefik runs on the host, or an exclusive private container network with no
published backend port. Restrict network access to Traefik. NextRequest does not
expose the TCP peer, so the app cannot independently inspect the ingress peer.
An authenticated proxy header supplements, but does not replace, isolation.

In Traefik static configuration set the public entrypoint's
`forwardedHeaders.insecure: false`, `forwardedHeaders.trustedIPs: []` and leave
PROXY protocol disabled. No upstream CDN/load balancer is supported by this
configuration. Traefik removes untrusted forwarding headers and derives
X-Real-IP from the TCP peer. Do not install middleware that restores client
X-Real-IP. See the [Traefik entrypoint documentation](https://doc.traefik.io/traefik/v3.6/reference/install-configuration/entrypoints/).

Configure a headers middleware on EVERY PAINI router, including login:

```yaml
http:
  middlewares:
    paini-ingress:
      headers:
        customRequestHeaders:
          X-Paini-Proxy-Secret: "REPLACE_WITH_PRIVATE_PROXY_SHARED_SECRET"
```

Traefik must overwrite the incoming secret header. Set the same private value
in PAINI's PROXY_SHARED_SECRET; use a distinct LOGIN_IDENTIFIER_KEY only in
PAINI. The app requires an authenticated secret plus one syntactically valid
X-Real-IP. X-Forwarded-For is never used. It stores keyed source identifiers,
not IP addresses. Missing/malformed headers reject login instead of falling
back to an attacker-controlled value. Do not expose the shared secret in logs.
The previous nginx example alone is no longer a supported production ingress.

Before opening access, verify the actual deployment: direct backend access from
outside must fail; missing/wrong secret on the private backend must return 403;
login attempts through Traefik with forged X-Real-IP and X-Forwarded-For must
still share the same source limit. Check a second real source remains able to
sign in. Configuration validation cannot prove firewall or Traefik settings;
these deployment checks are mandatory, particularly after proxy upgrades.

## Limits and persistence

All overrides are positive integer environment variables; restart after changes.
Defaults are in src/lib/security-config.ts, src/lib/auth.ts and src/lib/quotas.ts,
and listed in .env.example. LOGIN_SOURCE_LIMIT=30 per 60 seconds,
LOGIN_ACCOUNT_SOURCE_LIMIT=10 per 15 minutes, LOGIN_CONCURRENCY=4 concurrent
password-verification jobs. Account keys include the source; success clears only
that pair, preserving source abuse history. Missing and existing users each
receive one verification; one shared dummy-hash initialization per process uses
the unchanged Argon2id parameters. Initialization errors remain failures.

| Quota suffix | Student | Warden | Window |
| --- | ---: | ---: | --- |
| MUTATIONS | 60 | 300 | 60 seconds |
| UPLOADS | 20 | 60 | 60 seconds |
| BYTES | 10000000 | 50000000 | 24 hours |
| REPORTS | 10 | 10 | 24 hours |
| EVENTS | 50 | 300 | 24 hours |
| RETAINED | 100000000 | 500000000 | All retained photos |

Set QUOTA_STUDENT_<suffix> or QUOTA_WARDEN_<suffix>. Superadmin defaults match
warden limits and accepts QUOTA_SUPERADMIN_<suffix>; role authorization still
forbids report/photo use. Daily windows start at first usage, not calendar midnight.
The initial report event consumes REPORTS; later replies/status events consume
EVENTS. Replays of report/event submission keys do not consume those daily quotas.

Upload/report/event counters commit in the mutation's IMMEDIATE transaction;
failed validation and rollback do not consume them. The overall HTTP mutation
limit reserves before asynchronous work, refunds errors, and keeps in-flight work
bounded. A process crash can conservatively retain that reservation until its
60-second window expires. Failed storage/DB writes delete staged objects when
possible; storage outages/crashes can leave unreferenced objects requiring operator
reconciliation. These objects cannot be fetched through the protected photo API.

Retained usage is SUM(uploads.bytes), including pending AND attached photos.
Attaching never resets daily bytes or storage usage. Existing photos count on
upgrade. The existing cleanup command removes abandoned uploads; deleting rows
releases retained usage but never refunds daily upload/byte counters. No new
scheduler is needed. Keep existing cleanup/backup retention operations running.
Rate errors return 429; retained storage exhaustion returns 413 with the stable
error `Photo storage quota exhausted.` No other user's usage is returned.

Counters survive application restarts in SQLite; expired rows are removed on
subsequent quota/login activity. Same-host workers sharing the same SQLite file
share counters and password-work leases. Dead worker leases are reclaimed by PID
liveness checks; PID reuse may conservatively reduce capacity until that process
exits. Do not use network SQLite or separate per-instance DBs. The supported
service topology remains one supervisor. Multi-host deployment needs a shared
transactional limiter before scaling. Backups retain quota counters but strip
password-work leases and login counters; restoring rolls usage back to snapshot.

High thresholds increase CPU, disk, backup and notification exposure. Low limits
can interrupt ordinary users, especially users behind a shared NAT. Monitor 429s
and storage capacity; retained limits do not delete existing data or add capacity.

## Browser policy

The installed Next.js 16.4 CSP guide was used: src/proxy.ts generates a fresh nonce,
forwards CSP to the renderer, and enforces it on production HTML. The root layout
already uses cookies() and is dynamic. Script policy has no unsafe-inline or
unsafe-eval. Style-only unsafe-inline preserves existing dashboard style attributes.
Same-origin connections/photos and blob/data image previews are allowed. There
are no wildcard sources. Development uses report-only CSP to permit framework
debugging without adding unsafe-eval. Production is enforced, not report-only.
HSTS is production-only max-age=31536000, without includeSubDomains or preload.
Frame, MIME and referrer protections remain; Permissions-Policy denies camera,
microphone, geolocation, payment and USB. APIs/photos remain private, no-store.

## Verification

Run npm test, npm run lint, npm run build, npm audit, npm run test:e2e, and
`npx tsx tests/production-smoke.ts` after building. Use only synthetic test data.
Migration 004 adds quota/lease tables. The existing strict backup schema policy
means pre-migration archives require migration in an isolated old-version recovery
instance before producing an archive for this version; do not bypass schema checks.
