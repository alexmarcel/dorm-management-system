# Security deployment requirements

Production requires an exact HTTPS APP_ORIGIN, such as
https://paini.example.invalid (placeholder, no trailing slash, path, query,
fragment, wildcard or embedded credentials). Startup rejects a missing or invalid
production origin. NODE_ENV=production always produces Secure, HttpOnly,
SameSite=Strict, Path=/ session cookies with the existing 24-hour lifetime.
Development alone defaults to http://localhost:3000; specify APP_ORIGIN for
another local port.

The existing Docker/Traefik arrangement can remain unchanged. PAINI does not
require TRUSTED_PROXY_MODE, PROXY_SHARED_SECRET, LOGIN_IDENTIFIER_KEY,
X-Paini-Proxy-Secret, a dedicated Docker network, or Traefik middleware/static
configuration changes. The three legacy variables and secret header are ignored
and may be removed. There is no additional proxy secret to manage or rotate.
Keep the existing persistent DATABASE_PATH, UPLOAD_DIR and CONTROL_DIR settings.

## Best-effort source addresses

Login uses a syntactically valid X-Real-IP first, otherwise the rightmost valid
address in X-Forwarded-For (the hop closest to the application), otherwise the
stable unknown-source bucket. Each candidate is checked with Node isIP(); ports,
brackets, scope IDs and malformed strings are not used as identifiers. IPv6
spelling is canonicalized. Addresses are HMACed before reaching login counters;
raw addresses are not stored in PAINI's database or included in application
errors, logs or responses.

Forwarding headers are NOT authenticated. An attacker may spoof/rotate them,
or several users may share a proxy address. Source and account/source limits are
supplementary. The application-wide rate ceiling and shared password-work cap
remain effective regardless of header values. Missing headers do not return 403
or disable throttling. Unknown sources share a short-window bucket; there is no
username-only account lockout. A global/fallback ceiling can temporarily affect
legitimate logins during sustained abuse: this is the availability trade-off of
bounded work without an authenticated client address. Tune limits for actual load.

## Internal identifier key

PAINI generates a cryptographically random 32-byte key automatically at startup
in the existing private CONTROL_DIR/operations.db state table. An IMMEDIATE
transaction serializes concurrent initialization; restarts reuse the same key.
The key is not returned by any API or logged. No environment variable, new
migration, secret duplication or operator rotation is required. Invalid existing
key state fails safely rather than silently switching identity or disabling limits.

Keep CONTROL_DIR persistent and private, as already required for maintenance
state. Normal application backup/restore leaves this store untouched. Complete
archives intentionally exclude control state and strip all login counters, so
the key is not needed to interpret restored data and is not exported in archives.
Restoring an archive on a new installation creates a fresh key automatically;
restoring on the same installation keeps the existing key. Loss of control state
rotates source identifiers but cannot disable the independent global ceiling or
password concurrency cap. No changes to backup validation/extraction are needed.

## Limits and persistence

All overrides are optional positive integer environment variables; restart after
changes. Missing overrides use defaults; invalid numeric overrides are rejected.
Defaults are in src/lib/security-config.ts, src/lib/auth.ts and src/lib/quotas.ts,
and listed in .env.example.

| Login override | Default | Scope/window |
| --- | ---: | --- |
| LOGIN_GLOBAL_LIMIT | 120 | All admitted login attempts / 60 seconds |
| LOGIN_UNKNOWN_SOURCE_LIMIT | 60 | All unknown-source attempts / 60 seconds |
| LOGIN_SOURCE_LIMIT | 30 | Per best-effort source / 60 seconds |
| LOGIN_ACCOUNT_SOURCE_LIMIT | 10 | Per account and source / 15 minutes |
| LOGIN_CONCURRENCY | 4 | Concurrent password-verification jobs |

Limits apply before Argon2 work, atomically in the shared application database.
Requests already blocked by a source/account limit do not consume global budget.
Successful login clears only its account/source pair; global, source and unknown
history remain. Unknown sources have no account/source bucket, avoiding a
username-only lockout affecting every client without headers. Global and unknown
windows are short, with defaults above the per-source limit to allow normal use.
Missing and existing users each receive one verification; one shared dummy-hash
initialization per process uses unchanged Argon2id parameters. Initialization
errors remain failures. Password changes and restore re-verification also use the
shared concurrency cap.

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
