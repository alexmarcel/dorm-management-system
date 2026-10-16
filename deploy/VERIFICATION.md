# Security revision verification - 16 October 2026

This revision adds superadmin-managed quota and limit settings with migration 005,
while retaining optional proxy configuration, migration 004,
quotas, Argon2 cost/call-count protections, concurrency control, HTTPS origin
validation, secure cookies, security headers, authorization and backup safeguards.

Commands ran in the Windows workspace using npm.cmd (PowerShell script execution
policy prevents invoking npm.ps1). All final checks below exited 0. Output excerpts
are shown without terminal decoration.

```text
npm test
  tests 37
  pass 37
  fail 0
  cancelled 0
  skipped 0

npm run lint
> tsc --noEmit

npm run build
Next.js 16.4.0 (Turbopack)
Compiled successfully in 1231ms
Finished TypeScript in 1244ms
Generating static pages using 5 workers (2/2)
Routes /_not-found, /[[...path]], /api/[...path]: dynamic
Proxy (Middleware)

npm audit
found 0 vulnerabilities

npm run test:e2e
2 passed (58.4s)

npx tsx tests/production-smoke.ts
Production smoke passed: startup and login without proxy secrets or forwarding headers, enforced CSP rendering, authenticated dashboard, cookie flags, HSTS, permissions, private API caching, authentication and exact-origin rejection.
```

The production smoke leaves TRUSTED_PROXY_MODE, PROXY_SHARED_SECRET and
LOGIN_IDENTIFIER_KEY unset and submits login without a proxy secret or client-IP
header. It verifies automatic identifier-key creation at startup, successful login,
mutation quota exhaustion and validation-error refunds. It runs a real production
Next server and Chromium with isolated synthetic data. TLS termination is simulated
via exact Origin headers; the live Docker/Traefik deployment was not accessed.

New settings coverage verifies superadmin-only access, strict validation, atomic
saves and audit records, stale-edit conflicts, cross-process updates, persistence
and backup/restore. Runtime checks cover database overrides, unchanged active
quota windows, configurable login/concurrency limits, photo limits and fixed
upload expiration. Browser coverage includes saving, reloading, restoring default
values, role restrictions and translated settings. Desktop and mobile screenshots
were reviewed.

Existing security coverage verifies validated best-effort forwarding-header precedence, malformed
address fallback, IPv6 normalization, the global ceiling despite source/username
rotation, fallback limits without a username-only lockout, key persistence across
restart, concurrent initialization from four processes and fail-closed corrupt key
state. Backup/restore tests verify the control key survives and restored login
counters are empty. The key is intentionally not exported in archives because
those archives exclude private control state and strip source-identifier counters.

Existing coverage continues to pass for selective account/source clearing, generic
login errors, dummy initialization/verification call counts and failure caching,
bounded password work, quota rollback, user/role isolation, retained attached bytes,
report/reply quotas, multi-process upload races, origin/config validation, cookies,
headers, authorization, photo validation, traversal, backup integrity, restore and
session revocation.

Forwarding headers are supplementary and unauthenticated. Global rate and
concurrency limits are independent of them. Global/fallback ceilings can temporarily
affect legitimate users under sustained abuse; defaults and tuning are documented
in SECURITY.md. Production CSP remains enforced; development CSP is report-only.
Same-host workers must share the existing application and control SQLite stores.
Apply migration 005 with npm run db:migrate before starting the updated app.
No operator-managed secret or Traefik/network change is needed.

The browser suite used the Windows process-management permission required for
server teardown. The audit used registry access. Generated Next type-reference
changes were removed, and git diff whitespace checks passed. The patch contains
source, tests and documentation only; no private data or build output is included.
