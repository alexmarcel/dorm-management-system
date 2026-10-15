# Security patch verification — 15 October 2026

Commands ran in the Windows workspace using npm.cmd (PowerShell script execution
policy prevents invoking npm.ps1). All final checks below exited 0.

```text
npm test
? tests 28
? pass 28
? fail 0
? cancelled 0
? skipped 0

npm run lint
> tsc --noEmit

npm run build
? Next.js 16.4.0 (Turbopack)
? Compiled successfully in 811ms
Finished TypeScript in 742ms
? Generating static pages using 5 workers (2/2)
ƒ /_not-found
ƒ /[[...path]]
ƒ /api/[...path]
ƒ Proxy (Middleware)

npm audit
found 0 vulnerabilities

npm run test:e2e
2 passed (26.0s)

npx tsx tests/production-smoke.ts
Production smoke passed: enforced CSP rendering, authenticated dashboard, cookie flags, HSTS, permissions, private API caching, authentication and exact-origin rejection.
```

The production smoke also checks authenticated mutation exhaustion and that a
validation failure does not consume its reservation. It runs a real production
Next server and Chromium using isolated synthetic data. TLS termination is
simulated via exact Origin headers; this does not validate the deployed Traefik
or firewall. Follow SECURITY.md's deployment checks before rollout.

Backend coverage includes source/account throttling and selective clearing,
rotating usernames, generic login failures, dummy initialization/verification call
counts and failure caching, bounded password work, quota rollback, user/role
isolation, retained attached bytes, independent report/reply quotas, multi-process
upload race resistance, origin/config validation, cookie attributes and security
headers. Existing authorization, photo validation, traversal, backup integrity,
restore and session-revocation tests pass.

The initial browser run exposed an exact-label selector for Account status;
the test now uses the combobox accessible name. Restricted Windows process
management prevented initial Playwright teardown; the final permitted run exited
normally. The registry was initially unreachable in the sandbox; the permitted
audit completed successfully. No advisory remains reported by that audit.

Production CSP is enforced. Development CSP is report-only. Limits support
same-host workers sharing SQLite, not multi-host replicas. Crash/outage mutation
reservations can conservatively persist for their 60-second window. Schema 004
requires migration and changes strict backup compatibility; see SECURITY.md.

Git diff whitespace checks passed. Generated Next type-reference changes were
removed. The patch contains source, migration, tests and operator documentation;
no credentials, data, backups, dependencies or build artifacts are included.
