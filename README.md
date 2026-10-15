# PAINI

**PAINI - Pengurusan Asrama, Inventori, Naziran dan Insiden**

PAINI is a bilingual dorm maintenance application built with Next.js, TypeScript, and SQLite. Students report room problems, wardens manage progress through a timeline, and superadmin manages accounts, imports, and disaster recovery.

**Bahasa Melayu is the default language**, with a persistent English option. The official PAINI name is unchanged in either language.

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [Verification](#verification) · [Deployment](#deployment-and-worker) · [Full workflow](workflow.md)

## Features

- Configurable **Block → Level → Room** hierarchy with block and level codes.
- Unique internal report IDs and separate readable report numbers, such as `RED-G-00001`, sequenced independently per block/level.
- Private student reports, chronological updates, notifications, and role-specific dashboards.
- Multiple wardens with equal access to all reports; any active warden can update an open report.
- Permanent report closure enforced by application checks and SQLite triggers.
- Browser-compressed WebP photos, verified server-side and stored privately on local disk or S3.
- Superadmin Settings for warden accounts, student CSV import, password policy, and complete backup/restore.
- Responsive desktop/mobile layouts and Malay/English controls that preserve form drafts and selected photos.

### Roles

| Role       | Access                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Student    | Report any active room; view and reply only to their own reports.                                                                                                          |
| Warden     | Manage locations and students; view all reports and update or close any open report.                                                                                       |
| Superadmin | Manage wardens, password policy, CSV registration, and backups/restoration. No operational report, timeline, private-photo, location, or manual student-management access. |

Archived wardens retain historical authorship and reserved usernames, but immediately lose login access. Closed reports cannot be edited, replied to, deleted, or reopened through normal workflows.

Wardens can **Delete student / Hapus pelajar** in **Students / Pelajar**. This archives the account and revokes sessions without deleting reports or historical authorship. The **Deleted accounts** filter provides restoration; usernames and student IDs remain reserved, and old sessions never revive.

## Quick start

### Requirements

- Node.js 24 and npm.
- A persistent local filesystem for SQLite and private runtime files.
- For browser tests: Playwright Chromium (installation command below).

Clone or download this repository and open a terminal in its root. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

### 1. Install and configure

```sh
npm ci
```

Copy `.env.example` to `.env`:

```sh
# macOS / Linux
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

Edit `.env` and set your own `PAINI_SUPERADMIN_USERNAME` and `PAINI_SUPERADMIN_PASSWORD`. The password must contain 8–128 characters. **Do not commit credentials.** There is no shared default password in this repository.

### 2. Initialize and run

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Bootstrap creates one Superadmin after migration, using a globally unique username and a 8–128-character password. Change the password on first login. Restarts and environment edits never reset an existing account. No shared password is committed; examples contain empty placeholders. Keep `.env` private and untracked.

### 3. Set up the dorm

1. Sign in as superadmin and change the initial password.
2. Create wardens in **Settings → Warden Accounts**.
3. Sign in as a warden and enter blocks, levels, and rooms in **Locations**.
4. Register students manually through **Students**, or import them as superadmin using CSV.
5. Verify student submission, warden updates, and permanent closure before real use.

Superadmin lands on Settings and creates individual wardens there. Wardens manage real blocks/levels/rooms and manual students. CSV import is superadmin-only. No sample dorm data is created. Block and level codes produce report numbers such as RED-G-00001; internal report IDs remain globally unique.

To recover a forgotten superadmin password, explicitly supply `SUPERADMIN_RECOVERY_PASSWORD` through the server environment and run `npm run superadmin:recover`. Remove the variable afterward. This revokes sessions and requires another password change. The legacy `warden:create` command remains an OS-operator fallback using WARDEN_NAME, WARDEN_USERNAME and WARDEN_PASSWORD.

## Account security

Superadmin **Settings → Account security** controls “Require password change on first login” (default on). It applies to newly created/reset student and warden accounts, including CSV imports. Existing requirements remain unchanged; superadmin bootstrap/recovery always require a change. The setting is backed up with the database and changes are audited.

Warden management includes creation, editing, password reset, deactivation/reactivation, and archival/restoration. Student profiles support optional phone/email and room assignments. Reset, deactivation, and archival revoke sessions even when first-login password changes are disabled.

## Student CSV import

Superadmin can download a template, validate all rows, review a password-free preview, and confirm an all-or-nothing import.

```csv
fullname,username,password,phone number,email
Example Student,student01,ExampleOnly-ChangeMe123,0123456789,student01@example.com
Another Student,student02,ExampleOnly-ChangeMe456,,
```

These are illustrative values, not preconfigured accounts. Use unique temporary passwords when registering real students.

- UTF-8, including BOM; quoted fields, embedded commas, and CSV escaping are supported.
- Limit: **1,000 students / 2 MB** per file.
- `fullname`, `username`, and `password` are required; contact columns may be omitted or blank.
- Usernames must be unique across every role, including archived accounts. Student IDs derive from normalized usernames in uppercase.
- Imported students start active with no assigned room and follow the configured password-change policy.
- Invalid rows prevent all inserts. Existing accounts are never overwritten, and successful retries do not create duplicates.
- Raw CSV files and plaintext passwords are not persisted by the import workflow.

## Configuration

Use [.env.example](.env.example) as the starting point. Variables are server-side; never add a `NEXT_PUBLIC_` prefix to credentials.

| Variable                                     | Purpose / default                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_PATH`                              | Initial SQLite database path; `./data/paini.db`.                                                            |
| `UPLOAD_DIR`                                 | Private local photos when S3 is not configured; `./data/photos`.                                            |
| `CONTROL_DIR`                                | Persistent job/audit/recovery state and restored storage generations; example uses `./data/control`.        |
| `APP_ORIGIN`                                 | Exact public origin for mutation checks and secure cookies; local example is `http://localhost:3000`.       |
| `PAINI_SUPERADMIN_USERNAME`                  | Unique username for initial superadmin creation.                                                            |
| `PAINI_SUPERADMIN_PASSWORD`                  | Initial password only; never resets an existing account.                                                    |
| `MAX_BACKUP_BYTES`                           | Maximum compressed restore upload; default `1073741824` (1 GiB).                                            |
| `S3_BUCKET`                                  | Optional private bucket; enables S3 instead of local photo storage.                                         |
| `S3_REGION`                                  | S3 region; default `ap-southeast-1`.                                                                        |
| `S3_ENDPOINT`                                | Optional S3-compatible endpoint.                                                                            |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Optional environment credentials; an instance role or standard AWS credential provider can be used instead. |
| `SUPERADMIN_RECOVERY_PASSWORD`               | Explicit recovery-only password; remove after running the recovery command.                                 |

Photo limits are **1,600 pixels maximum dimension** and **500,000 bytes** per compressed WebP. The server validates format, dimensions, size, and ownership.

## Commands

| Command                      | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `npm run dev`                | Development app with the maintenance supervisor.              |
| `npm run build`              | Production build.                                             |
| `npm start`                  | Production app and supervised background worker.              |
| `npm run db:migrate`         | Apply migrations and bootstrap superadmin if configured.      |
| `npm run superadmin:setup`   | Explicit idempotent superadmin setup.                         |
| `npm run superadmin:recover` | Reset superadmin using the recovery environment variable.     |
| `npm run warden:create`      | Server-operator fallback for warden provisioning.             |
| `npm run backup`             | Queue a complete backup; requires a running supervisor.       |
| `npm run cleanup`            | Remove expired unattached uploads, sessions, and rate limits. |
| `npm run lint`               | TypeScript validation.                                        |
| `npm test`                   | Backend tests.                                                |
| `npm run test:e2e`           | Isolated browser workflows.                                   |
| `npm run format`             | Format application code and configuration.                    |

## Verification

```sh
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Tests use isolated databases/control stores and synthetic credentials. Browser screenshots/traces go to ignored `test-results/`. Coverage includes role isolation, account policy, CSV atomicity, photo validation, report immutability, archive validation, and supervised restore/recovery. S3-compatible tests use a local test service; verify your actual bucket and hosting separately. Never use test files for production.

## Deployment and worker

1. Install with `npm ci` and build with `npm run build`.
2. Set absolute persistent local paths for DATABASE_PATH, UPLOAD_DIR and **CONTROL_DIR**, outside release/public directories. SQLite WAL must not use a network filesystem. Restrict OS permissions; control data includes backups, audit and recovery state.
3. Set exact HTTPS APP_ORIGIN. Keep the existing Docker/Traefik arrangement; no additional proxy secrets, dedicated network, or middleware/static configuration changes are required. See [deploy/SECURITY.md](deploy/SECURITY.md) for limits and automatic identifier-key persistence. Match archive limits to MAX_BACKUP_BYTES; allow 3 MB JSON requests for escaped CSV. Disable proxy request buffering for archives.
4. Optional S3: configure S3_BUCKET, S3_REGION, standard AWS credentials/instance role and optional S3_ENDPOINT. Keep the bucket private. Permit reads/writes for original objects and restored/ namespaces.
5. For upgrades, take a complete backup, stop writes, run `npm run db:migrate`, then start **one `npm start` supervisor** under an unprivileged service account. Do not use bare next start: the supervisor owns the queue and restart lifecycle. Startup also checks migrations and bootstrap.
6. Let the service manager restart the supervisor on failure. Keep its child in the same service/process group so stopping the service stops both. One supervisor may own a control directory. Preserve it between releases.
7. Configure wardens/locations/students. Verify submission through closure and staging restoration before admitting users. Actual S3 credentials and hosting require deployment-specific verification.

## Backup, restore and retention

Settings → Backup and Restore → Create backup queues a background job. It uses SQLite's online backup API and copies all committed photos referenced by that snapshot. A tar.gz manifest records schema, timestamp, counts, sizes and SHA-256 checksums. Missing photos fail the job. Environment files, infrastructure secrets, logs, caches and temporary uploads are excluded. Sessions are stripped. Superadmin downloads are audited. **Archives contain personal information and password hashes: encrypt off-server copies and restrict access.**

Schedule `npm run backup` daily while the supervisor runs; it queues the same complete job, not a database-only snapshot. Archives live under `CONTROL_DIR/jobs/<job-id>/backup.tar.gz`. Copy off-server and retain 30 daily backups. No automatic deletion is performed. Monitor disk/failed jobs. Retain recovery archives and previous generations until verified; never remove an active generation.

Restore uploads stream with MAX_BACKUP_BYTES (default 1 GiB). Validation checks safe paths/types, duplicates, file counts/expanded size, checksums, exact supported schema/triggers, SQLite integrity, foreign keys and every photo. Review timestamp/counts and confirm using the current superadmin password.

The worker enters maintenance, drains requests, stops the app, creates a complete recovery backup, stages new database/photo storage, selects the new generation and restarts the app. Users log in with snapshot credentials. Later changes—including closures and passwords—are lost. This is disaster recovery, not report reopening. Failed cutover reselects the previous generation. Interrupted restore rolls back from the persisted recovery pointer on startup.

CONTROL_DIR/operations.db holds jobs, independent audit, maintenance and active-generation pointers and is **not replaced** by an uploaded backup. After restoration, DATABASE_PATH is only the initial fallback: the pointer identifies the current database. Never copy over live WAL files or edit pointers while running. For operator rollback, stop the service, preserve control data, identify the recovery archive in audit, and validate/recover through a clean isolated instance before reopening access.

Schedule `npm run cleanup` hourly. It respects maintenance, removes expired unattached uploads/sessions and never deletes committed photos. Run OS-level migration/recovery commands with service writes stopped.

## Security and scope

Argon2id passwords, hashed random 24-hour sessions, origin checks, forced password changes and explicit server permissions protect access. Reset/deactivation/archive revoke sessions. SQL closure triggers remain authoritative. SQLite uses WAL, foreign keys, short immediate transactions and a five-second busy timeout.

Dates use Asia/Kuala_Lumpur and ms-MY/en-MY; stored timestamps remain UTC. User content and canonical API/database values are unchanged. Inventory, inspection, bulk room import and public registration remain outside this release.

## Repository layout

```text
src/app/          Next.js pages, API routes, and global styles
src/components/   Bilingual application UI
src/lib/          Authentication, permissions, SQLite, storage, and jobs
migrations/       Versioned SQLite migrations
scripts/          Supervisor and server-management commands
tests/            Backend and browser tests
deploy/           Reverse-proxy configuration example
workflow.md       Detailed product requirements and acceptance criteria
```

## Contributing and publishing safely

Keep changes focused and run type checks, backend tests, relevant browser tests, and a production build before opening a pull request. Preserve role boundaries, report-number uniqueness, private photo access, and closed-report immutability.

`.gitignore` excludes environment files, private keys, databases and sidecars, runtime storage, uploads, imports, recovery archives, logs, and generated build/test artifacts. `.env.example`, migrations, source, and `package-lock.json` should remain versioned. Keep custom runtime directories outside the repository or add their exact paths to `.gitignore`.

Before publishing, inspect `git status --short` and `git diff --cached`. Ignore rules do not remove already tracked files or erase Git history. If a secret was previously committed, rotate it and address the repository history before making it public. Do not attach real student CSVs, private report photos, or backup archives to issues or pull requests.
