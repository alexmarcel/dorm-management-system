# PAINI — Detailed Plan and Workflow

## 1. Purpose and agreed requirements

System name: **PAINI - Pengurusan Asrama, Inventori, Naziran dan Insiden**.

Build a mobile-friendly web application where students report dorm room maintenance problems and wardens respond, record progress, and close reports. The system name does not expand the agreed version-one scope to inventory or inspection modules.

The dorm initially has three blocks. Each block contains configurable levels, and each level can contain rooms. Empty blocks and levels are allowed during setup.

The agreed requirements are:

- Use Next.js with TypeScript and SQLite, hosted on one persistent server/VPS.
- Wardens manually create student login information in a Student Management page.
- Superadmin can additionally register students using a validated, all-or-nothing CSV import.
- Support Bahasa Melayu (`ms`, default) and English (`en`) with a persistent language switch.
- One administration-only superadmin manages wardens, complete backups/restoration, and CSV import from Settings.
- Students can report a problem in any active room, not only their assigned room.
- Students can view only the reports they created, including their associated timelines and photos.
- Multiple wardens can exist. All wardens have equal access across all blocks and can update any open report.
- Wardens can view each room's complete report history across all students.
- Reports and their updates appear in timelines with authors and timestamps.
- All uploaded photo attachments must be compressed.
- Once any warden closes a report, it is permanently read-only for everyone.

This document is the implementation plan, not a record of completed functionality. Technical limits and defaults below are the planned version-one behavior.

## 2. Roles and permissions

| Capability | Student | Warden | Superadmin |
|---|---|---|---|
| Submit reports | Any active room | No | No |
| Read reports, timelines and private photos | Own reports | All reports | No |
| Reply with photos | Own open reports | Any open report | No |
| Update status or close | No | Any open report | No |
| Modify/reopen closed reports | No | No | No |
| Full room history and operational dashboards | No | Yes | No |
| Manual student management and locations | No | Yes | No |
| Warden management, complete backup/restore, student CSV import | No | No | Yes |
| Own password and language | Yes | Yes | Yes |

Reports are not restricted to an assigned warden. A warden can continue work started by another warden. Every timeline entry identifies the person who posted it.

Room assignments preselect a location for convenience. They neither limit reporting locations nor grant access to other students' reports. Changing assignments does not change report ownership.

## 3. Application navigation and presentation

### System identity, login, header, and footer

- Use the exact system name: PAINI - Pengurusan Asrama, Inventori, Naziran dan Insiden. Preserve this Malay name even where interface labels are English.
- Login page: prominently display PAINI above the sign-in form, with Pengurusan Asrama, Inventori, Naziran dan Insiden immediately underneath.
- Shared header: display PAINI and the full expanded name for all three roles, including account/password-change pages. Link the brand to the role's home (dashboard or Settings).
- Shared footer: display PAINI - Pengurusan Asrama, Inventori, Naziran dan Insiden on both login and authenticated pages.
- On narrow screens, allow the expanded name to wrap beneath PAINI rather than hiding or truncating it. Keep the header navigation usable and the footer clear of form controls and content.
- Centralize the short name, expanded name, and full name in shared application constants so all placements remain consistent.

### Student navigation

- Dashboard
- My Reports
- New Report
- Notifications
- Account: change password and logout

### Superadmin navigation

- Settings (home after login/password change): Warden Accounts, Backup and Restore, Student CSV Import.
- Account: own password; shared language switch and logout.
- Show administrative account counts and operation results only, never report content.
- Apply explicit role checks to every Settings API and all report/dashboard/notification/photo/location/student APIs. Never treat “not student” as warden.

### Warden navigation

- Dashboard
- Reports
- Locations
- Student Management
- Notifications
- Account: change password and logout

Report details and room histories open from their relevant lists. Use responsive layouts for phones and desktops, accessible labels, keyboard navigation, and status text that does not rely only on color.

Provide loading states, empty states, clear validation messages, and retry actions. Retain unsent text when recoverable errors occur.

### Role-specific home dashboards

After login and any required password change, students and wardens open their dashboard; superadmin opens Settings. On phones, place summary cards and actionable report lists before charts. Display report numbers to users and use report IDs for navigation and data relationships.

The student dashboard shows only the signed-in student's information:

- Summary cards: total reports, Submitted, Acknowledged, In progress, and Closed. Counts cover all of that student's reports.
- Five most recently updated open reports, showing report number, title, location, status, and latest update time.
- Five latest warden updates on their reports, including closing explanations, with links to the relevant timelines.
- Unread notification count and an action to open Notifications.
- Assigned room, or an explicit unassigned state, without restricting the reporting location.
- Quick actions for Report a problem and View my reports. Status cards open the corresponding filtered My Reports list.

Do not expose room-wide or dorm-wide totals to students. If there are no reports, show a short explanation and the Report a problem action rather than empty charts.

## 4. Login and student management

### 4.1 Student account creation

Wardens create student accounts manually in Student Management. There is no public registration or invitation flow.

Required fields:

- Full name
- Student ID
- Username
- Initial password

Optional fields:

- Assigned room, selected through Block → Level → Room
- Phone number (string, preserving leading zeroes and `+`) and email (validate if non-empty). Wardens can maintain contact information for both manually created and imported students.

Student IDs and usernames must be unique after trimming and case normalization. Wardens communicate credentials outside the app. Never log, retain plaintext copies of, or later reveal an existing password.

Create authentication and student-profile records in one transaction. If creation fails, do not leave a partial account.

### 4.2 First login and password changes

Superadmin Settings includes **Account security → Require password change on first login**, enabled by default and persisted in SQLite (`003_password_policy.sql`). Only superadmin can change it; audit each change. The current setting applies inside the transaction when creating or resetting students/wardens, including manual registration, CSV import and operator warden creation. Disabling it does not clear existing `must_change` flags; enabling it does not retroactively force established accounts. Password resets still revoke sessions regardless of this policy. Initial superadmin bootstrap and explicit superadmin recovery always require a password change. All “require first-login password change” statements below describe the default enabled policy for student/warden accounts.

1. Student signs in using the supplied username and initial password.
2. The app requires a new password before allowing access to other pages.
3. Until completed, only password change and logout are permitted.
4. Once completed, the student enters their Dashboard.

Provide normal password change for authenticated users. Students who forget passwords contact a warden.

### 4.3 Student Management page

Display name, student ID, username, assigned block/level/room, and active/inactive status.

Provide:

- Search by name, student ID, or username.
- Filters by block, level, room, and account status.
- Add student.
- Edit student details.
- Change room assignment.
- Reset password.
- Deactivate or reactivate account.

A reset sets a temporary password, invalidates existing sessions, and requires another password change at next login. Deactivation invalidates sessions and prevents access. Reactivation does not revive revoked sessions.

Wardens can choose **Delete student / Hapus pelajar** from the Pelajar row actions. Confirm before archiving the student account, setting it inactive, revoking every session, and recording the action in the audit log. Hide deleted accounts from the default list; use the **Deleted accounts / Akaun yang dihapus** status filter to view and restore them. Restoration reactivates the account but never restores revoked sessions. Reject ordinary edits/password resets while archived. Preserve student identity, reserved username/student ID, all reports, photos and timeline authorship, including closed-report snapshots. This is recoverable account deletion, not permanent destruction of report history. Only active wardens may delete/restore students; students and superadmin cannot call these endpoints.

### 4.4 Multiple warden accounts

The superadmin provisions wardens through Settings. Create with full name, globally unique username, and a 8–128-character temporary password. Search by name/username; list status and creation date. Edit name/username, deactivate/reactivate, reset passwords, archive, filter archived accounts, and restore. Reset requires a password change at next login. Deactivation, reset and archiving revoke sessions immediately. Archiving retains account identity, report references and historical authorship; usernames remain reserved. Restoration does not revive old sessions. The server-side warden command remains an operator fallback, not the normal provisioning workflow.

All wardens have the same report, location, and student-management permissions. There is no block-specific restriction or exclusive report ownership. Students cannot create or promote warden accounts.

### 4.5 Language workflow

Use `ms` and `en`. First visits use Malay regardless of browser language. Login and the shared header offer clearly labeled Bahasa Melayu / English controls. Store the choice in the `paini_locale` cookie across navigation, reloads, login and logout; set the document `lang`. Switch client-side without remounting forms or losing selected photos. PAINI's official name never changes.

Central dictionaries translate navigation, dashboards, statuses/categories, form labels, buttons, validation/API errors, dialogs, accessibility labels, notifications, Settings and loading/empty states. Canonical database/API values remain unchanged. Never translate user descriptions, replies, names, location labels or closure snapshots. Render system event labels in the selected language. Format dates/numbers with `ms-MY`/`en-MY`; use Asia/Kuala_Lumpur for display and UTC storage. API errors provide a stable code and parameters rather than relying on translated database values.

### 4.6 Superadmin bootstrap and recovery

Set server-only `PAINI_SUPERADMIN_USERNAME` and `PAINI_SUPERADMIN_PASSWORD` in the untracked environment file; committed examples contain empty placeholders. After migrations, an idempotent bootstrap creates one account named `Superadmin`, hashes its 8–128-character password with Argon2id and requires a first-login password change. Existing superadmin credentials are never overwritten by a restart or environment edit. Username collisions with other roles fail; no silent promotion. A unique database constraint prevents multiple superadmins. No UI creates/deletes superadmins.

For forgotten passwords, an OS administrator explicitly sets `SUPERADMIN_RECOVERY_PASSWORD` and runs `npm run superadmin:recover`; revoke sessions, require password change, record recovery without logging the password, then remove the recovery variable. This is separate from initial bootstrap credentials.

### 4.7 Student CSV registration

Only superadmin can import. Download the template, choose UTF-8 CSV (BOM supported), validate every row, inspect a password-free preview with row/field errors, and confirm only when all rows are valid.

```csv
fullname,username,password,phone number,email
Nur Aisyah,aisyah01,TemporaryPassword123,0123456789,aisyah@example.com
Muhammad Amir,amir01,TemporaryPassword456,,
```

- `fullname`, `username`, `password` required; contact columns may be omitted or blank. Handle quoted fields, embedded commas, doubled-quote escapes and blank lines.
- Limit 1,000 students and 2 MB. Validate existing username/password rules and non-empty email. Preserve phone as a string.
- Normalize usernames and derive uppercase student IDs from them. Detect duplicates within the file and conflicts with any existing username (including archived accounts) or student ID.
- Any invalid row prevents all inserts. Never overwrite an account. Create active students with no room and mandatory password change.
- Hash before opening the write transaction. Recheck permissions and all uniqueness constraints at commit. Concurrent conflicts roll back every insert.
- A unique import operation ID makes successful retries idempotent; reject reuse for different content/actor. Record actor, timestamp and count, not plaintext passwords or raw CSV.
- Process input transiently; do not write raw CSV to disk, logs, browser storage or audit records. Clear selected input/content after a successful import. Passwords never appear in previews/errors.

## 5. Blocks, levels, and rooms management

### 5.1 Hierarchy and page layout

The hierarchy is Block → Level → Room. Each level belongs to one block, and each room belongs to one level.

- Show block cards with names, level counts, and room counts.
- Selecting a block shows its levels.
- Selecting a level shows its rooms.
- Use breadcrumbs such as Locations / Block A / Level 2.
- On phones, show one hierarchy level at a time.
- Provide contextual Add block, Add level, and Add room actions.
- Show meaningful empty states for blocks without levels and levels without rooms.

### 5.2 Forms

| Form | Required fields | Parent |
|---|---|---|
| Add/edit block | Block name, block code (for example, RED) | None |
| Add/edit level | Level name, level code (for example, G or 1), display order | Currently selected block |
| Add/edit room | Room number/name | Currently selected level |

Order levels by display order, then name. Sort room labels naturally so Room 2 appears before Room 10.

### 5.3 Validation and lifecycle

- Require non-empty trimmed names.
- Block names must be unique.
- Require a unique block code, such as RED, for the block segment of report numbers. Trim and normalize codes to uppercase; allow letters and digits without spaces or hyphens. Enforce uniqueness across active and archived blocks.
- Display block codes alongside block names in Locations. Keep existing report numbers unchanged if a block code is later edited.
- Level names must be unique within their block.
- Require a short level code for report numbers, such as G for Ground Floor or 1 for Level 1. Trim and normalize to uppercase; allow letters and digits without spaces or hyphens. Codes must be unique within their block, including archived levels.
- Room names must be unique within their level.
- Compare names without case sensitivity, including archived records.
- Allow identical room numbers in different levels or blocks.
- Support the initial three blocks without a fixed maximum.
- Use stable IDs so renaming does not break report references.
- Do not move existing levels or rooms between parents in version one.
- Enter rooms individually; bulk import and generation are deferred.

### 5.4 Archiving and restoration

Use archiving instead of permanent deletion. Confirm the affected level and room counts before archiving a parent.

An archived location, or a location with an archived ancestor, is unavailable for new reports and new room assignments. Preserve existing assignments and reports. If a student's assigned room becomes unavailable, require selection of another active room for new reports.

Restoring a parent makes descendants available only if they are not independently archived. Wardens can include archived locations when reviewing history.

Open reports display current location names. Closed reports preserve their historical display as described in the closure section.

## 6. Student reports and timelines

### 6.1 My Reports

Show only the signed-in student's reports, newest submissions first, with pagination and status filtering.

Each entry shows:

- Report number
- Title and category
- Block, level, and room
- Submission date/time
- Current status
- Latest update preview

Include a prominent Report a problem action.

Each report has two distinct identifiers:

- Report ID (`id`): an immutable internal primary key, unique across all reports regardless of block or level. Use this ID for relationships, report routes, and API operations.
- Report number (`report_number`): the human-readable number shown in lists, timelines, and notifications, using BLOCKCODE-LEVELCODE-SEQUENCE, such as RED-G-00001. The block and level segments come from their respective code fields.

Report numbering rules:

- Use five-digit zero padding: 00001, 00002, and so on.
- Maintain a separate sequence for each block and level, keyed by stable location IDs. Rooms on the same level share that sequence.
- For example, RED-G-00001 and RED-G-00002 are followed independently by RED-1-00001 and BLUE-G-00001 in those other locations.
- Start each new block/level sequence at 1. Do not reset counters annually, on closure, on archiving/restoration, or when codes are renamed.
- Allocate the next unused report number and increment its counter inside the same SQLite write transaction that creates the report. Enforce a unique database constraint on the complete report number; if a historically used code combination would collide, advance to the next unused number within that transaction.
- Retried submissions return the already-created report with the same report ID and report number.
- Persist both identifiers permanently. Existing report numbers never change when block or level codes/names change; subsequent reports use the current codes and continuing counter. Per-block/level counters apply only to report numbers, never to report IDs.
- Five digits is the minimum width. After 99999, continue at 100000 without wrapping or reusing report numbers.

### 6.2 New Report form

Require block, level, room, title, category, and description. Photos are optional.

Categories:

- Locks/doors
- Lighting
- Electricity
- Plumbing
- Furniture
- Other

Preselect the assigned room if available, but allow any other active room. Changing block clears level and room; changing level clears room. Levels without available rooms cannot serve as report destinations.

### 6.3 Submission workflow

1. Validate required content and the selected location.
2. Process any attached photos according to the compression policy.
3. Upload compressed photos to private temporary storage.
4. Submit the report, validating the location and attachments again on the server.
5. Atomically assign a globally unique report ID, allocate its block/level report number, and create the report in Submitted status with its initial timeline event and attachment references.
6. Create notifications for active wardens.
7. Open the report detail page.

Retain text when validation or upload fails. Do not silently omit selected images. Use a submission identifier to prevent duplicate reports on retries, alongside disabling repeated submission clicks.

### 6.4 Report detail and replies

Display the report's original content, location, photos, current status, and chronological timeline. Timeline events appear oldest first, with stable ordering when timestamps match.

Students can add text replies and optional photos while their report is open. Original content and previous events are not edited or deleted through the app; corrections are added as new replies.

Each event displays its type, author, server-generated timestamp, message, optional photos, and status transition when applicable.

## 7. Warden dashboard and shared workflow

### 7.1 Warden Dashboard and Reports page

The warden Dashboard provides a dorm-wide overview for all wardens, not just reports they previously handled. Offer cascading block, level, and room filters, defaulting to all locations. Apply the selected location filters consistently to report metrics, charts, and activity lists. Include reports from archived locations in historical metrics and allow those locations to be selected with an Archived label.

Dashboard content:

- All-time summary cards for total reports, Submitted, Acknowledged, In progress, and Closed. Open reports means Submitted + Acknowledged + In progress.
- Needs attention: the five oldest Submitted reports, with report number, title, location, and time since submission.
- Oldest open reports: the five longest-open reports, with current status and last update time. Label these as oldest, not overdue, because no service deadline has been defined.
- Latest activity: the ten most recent submission, reply, update, and closure events across wardens and students. Show actor, report number, location, event summary, and timestamp.
- Open reports by block and by category, displayed as compact bar charts or labeled count lists. Clicking a group opens Reports with that location/category and open-status filter.
- A daily submitted-versus-closed trend for the last 30 calendar days including today, using Malaysia dates. Submissions are counted by creation time and closures by closure time, even when the report was created before the chart window. Include days with zero activity.
- Average time to close for reports closed in the same 30-day window, calculated from creation to closure. Show the number of reports used and display No closed reports instead of zero when there are none.
- Dorm setup totals for active students and effectively active blocks, levels, and rooms, with links to Student Management and Locations. Clearly label these as dorm-wide totals unaffected by report-location filters.
- Quick actions to view Submitted reports, manage students, and manage locations.

Summary cards open the Reports page with matching location and status filters. Time-based widgets explicitly show their 30-day window; summary and open-workload widgets show their all-time/current scope. All-time total must equal the sum of the four status counts.

The separate Reports page lists reports newest first with pagination and status counts.

Filter by block, level, room, category, status, and reporting student. Open a report to reply, attach photos, post an update, or change status.

Any warden can act on any open report, including reports previously updated by another warden. No assignment or claim step is required.

Compute dashboard aggregates on the server from reports and events rather than from a paginated client list. Authorize aggregate and activity operations by role; student queries must filter by creator before aggregating. Avoid double-counting reports when joining events or attachments. Use uncached user-specific responses and the same 30-second refresh/tab-focus behavior as notifications. Display loading, failure/retry, empty, and last-refreshed states.

### 7.2 Status transitions

| Current status | Allowed next statuses |
|---|---|
| Submitted | Acknowledged, In progress, Closed |
| Acknowledged | In progress, Closed |
| In progress | Closed |
| Closed | None |

Every status change requires an explanation. Wardens can post progress updates without changing status. Save the status change and corresponding timeline event in one transaction.

For a status change, verify that the status the warden acted on is still current. If another warden changed it, return a conflict and refresh the display rather than silently replacing their action.

### 7.3 Room history

Wardens can open any room to view all associated reports across all students, including closed reports and reports from former residents. Students cannot access this combined history.

## 8. Permanent closure and concurrent updates

### 8.1 Closing workflow

1. Any warden chooses Close report.
2. The warden enters a required closing explanation and optional compressed photos.
3. The interface explains that closure permanently prevents further changes.
4. The warden confirms.
5. The server atomically records the final event, Closed status, closing warden, closure time, and historical display snapshot.
6. The reporting student receives a closure notification.

### 8.2 Closed-report restrictions

Closed reports are permanently read-only for both students and all wardens. Do not allow:

- Changes to report details or location.
- New, edited, or deleted replies and timeline events.
- New, replaced, or deleted attachments.
- Further status changes or reopening.
- Report deletion.

Authorized users may continue to read the report and photos. Marking a notification as read is allowed because it does not change the report.

If the problem returns, the student creates a new report. There is no reopening workflow.

### 8.3 Historical display

At closure, snapshot the displayed block, level, room, and participant names needed by the report history. Later changes to location names or student profiles must not change the closed report's historical display.

Retain original room and user IDs for permission checks, ownership, and room-history lookup.

### 8.4 Concurrency enforcement

Enforce restrictions on the server and in SQLite database triggers; hiding buttons is insufficient. Route report mutations through short `BEGIN IMMEDIATE` transactions, acquiring SQLite's write transaction before checking permissions and current report status. SQLite serializes writers rather than providing report-row locks. Do not permit direct client database writes.

Commit the event, status change, attachment references, and notifications together. Keep image processing, uploads, password hashing, and network operations outside write transactions. Roll back the whole transaction on failure.

- Concurrent replies on an open report are preserved as separate events.
- A reply committed before closure appears before the closing event.
- If closure commits first, reject the reply or update with a conflict response.
- Attachment finalization must recheck report status; a completed upload is not permission to attach after closure.
- Repeated closing requests must not create duplicate closing events.
- SQLite triggers must reject changes to closed report content and its events/attachment records, including inserts, updates, and deletes that would alter closed history. Write the final event and attachment references before setting Closed within the same transaction.

Configure a five-second busy timeout. If write contention remains after the timeout, roll back and return a retryable error without losing form content. Retried mutations must use stable submission identifiers to prevent duplicate events or notifications. A stale status or already-closed report returns a conflict, not an automatic retry.

Show a clear message when a report closed during editing, and refresh it into read-only mode. Do not attach pending images to the closed report.

## 9. Mandatory photo compression and storage

### 9.1 Limits

The same policy applies to student submissions, student replies, warden updates, and closing attachments.

| Property | Planned limit |
|---|---|
| Photos per submission or event | Five |
| Source formats | JPEG, PNG, WebP |
| Source size | Up to 20 MB per photo |
| Stored format | WebP |
| Stored longest side | At most 1,600 pixels |
| Stored size | At most 500 KB per photo, defined as 500,000 bytes |

### 9.2 Client processing

Before uploading:

1. Decode the image and correct orientation.
2. Resize proportionally to fit the dimension limit without enlarging smaller images.
3. Re-encode as WebP starting at 80% quality.
4. Reduce quality, then dimensions, until the size limit is satisfied.
5. Remove metadata, including GPS information.
6. Display the compressed preview.

Process photos sequentially on phones to limit memory use. Show processing and upload states and allow removal or replacement before submission.

Upload and retain only compressed versions. Never upload or store originals. If processing fails, identify the image and allow replacement or removal; do not fall back to uploading the original.

### 9.3 Server validation and privacy

Validate actual decoded image content, supported format, dimensions, and byte size rather than trusting filename or client metadata. Reject unsupported, corrupt, or oversized processed files. Strip any remaining metadata before permanent storage, while preserving the limits.

Store photos privately. Authorize access using report ownership or warden role before serving the image. Use authenticated access or short-lived authorized retrieval URLs; do not expose permanent public URLs.

Maintain attachment metadata including private storage key, byte size, format, width, and height. Reject attachment references not owned by the submitting upload session or already attached elsewhere.

Remove abandoned temporary uploads after 24 hours through a scheduled cleanup task. This cleanup must never remove committed report attachments, including attachments on closed reports.

## 10. Notifications

| Event | Recipients |
|---|---|
| New student report | All active wardens |
| Student reply | All active wardens |
| Warden reply/progress update | Reporting student |
| Status change or closure | Reporting student |

Provide a paginated list and unread count. Opening a notification marks it read and navigates to the report. Reading notifications remains possible for closed reports.

Persist notification records with the corresponding report event transaction to avoid missing or duplicate notifications. Periodically refresh visible reports and notifications while the app is active; use a 30-second interval and refresh when a tab regains focus.

Notifications never override report access permissions. No email or push maintenance alerts are included in version one.

## 11. Technical architecture and data model

### 11.1 Components

- Next.js App Router with TypeScript for the responsive web interface and authenticated server endpoints.
- Node.js runtime for database access and server-side authentication; do not run SQLite operations in the Edge runtime.
- SQLite accessed through `better-sqlite3` for application data and database-backed sessions, with versioned SQL migrations.
- Username/password authentication with Argon2id password hashing.
- Private object storage for compressed photos.
- Browser-side image processing and server-side image validation.
- Scheduled cleanup for abandoned temporary uploads.

Select compatible maintained dependency versions during implementation and record them in the lockfile. Infrastructure credentials belong in server environment configuration, never browser code.

Deploy one Next.js application instance on a persistent server/VPS behind an HTTPS reverse proxy. Keep the SQLite file on local persistent disk outside the source tree, public directory, and application release directory. Configure its absolute path through a server environment variable. Exclude database files, WAL/SHM sidecars, and backups from source control. Do not use an ephemeral filesystem or a network share for the live database.

Keep compressed photos in private object storage as already planned; SQLite stores only their references and metadata, not the image bytes.

### 11.2 Core entities

| Entity | Key information |
|---|---|
| User | ID, name, student/warden/superadmin role, globally unique normalized username, password hash, active state, archive timestamp, password-change requirement, creation time |
| Student profile | User ID, unique student ID, optional room ID, optional phone string and email |
| Administration audit | Actor, action, target, timestamp and non-secret operation metadata |
| Student import operation | Unique retry ID, actor, input fingerprint, imported count, timestamp; no raw CSV/passwords |
| Separate control database | Background job status/progress, independent operational audit, maintenance/request leases, active storage generation and recovery pointer |
| Session | User ID, hashed session token, expiry, revocation state |
| Block | ID, name, unique normalized block code, archive state |
| Level | ID, block ID, name, normalized level code unique within block, display order, archive state |
| Room | ID, level ID, room label, archive state |
| Report number counter | Block/level IDs as unique key, last allocated report-number sequence |
| Report | Globally unique immutable ID, unique immutable report number, creator, room, title, description, category, status, timestamps, closure metadata |
| Report event | Report ID, actor, type, message, previous/new status, timestamp |
| Attachment | Event ID, private object key, compressed size, format, dimensions |
| Temporary upload | Owner, object key, validation state, creation time, expiry |
| Notification | Recipient, event ID/report ID, creation time, read time |

Store a closure snapshot containing the historical labels required to display a closed report independently of later profile/location renaming.

Use foreign keys and uniqueness constraints. Index report creator, room, status, creation time, event report/order fields, and notification recipient/read state. Store timestamps in UTC.

### 11.3 Authenticated interfaces

Provide server operations for:

- Login, logout, and password change.
- Student creation, listing, editing, room assignment, password reset, and activation.
- Location hierarchy listing, creation, renaming, ordering, archiving, and restoration.
- Report creation, permitted listing, detail retrieval, and warden-only room history.
- Adding replies/progress events, changing status, and final closure.
- Validated photo upload, attachment finalization, and authorized photo retrieval.
- Notification listing and marking read.
- Role-scoped dashboard summaries and activity, plus warden-only location-filtered workload and 30-day trend aggregates.
- Superadmin-only Settings account counts, warden management, CSV preview/commit/template, backup jobs/downloads, restore upload/validation/confirmation.

Derive actor identity, role, timestamps, and initial report status on the server. Never accept client-supplied authority or ownership.

Return clear validation errors for invalid input and conflict responses for closed-report mutations or stale status changes. Use consistent pagination and stable ordering.

### 11.4 Security and consistency

- Authorize every request by role, active account status, and report ownership.
- Use secure HTTP-only session cookies and cross-site request forgery protection for mutations.
- Rate-limit authentication attempts.
- Require password change before other actions when flagged.
- Invalidate sessions after reset or deactivation.
- Never expose password hashes or log credentials, session secrets, or temporary passwords.
- Make account creation, report creation, event creation, notifications, and closure transactional where they share database state.
- Use database closure guards as well as server checks.
- Preserve historical data when users and locations are deactivated or archived.

### 11.5 SQLite configuration, migrations, and backups

- Enable WAL mode for the database and foreign-key enforcement on every connection.
- Set a five-second busy timeout on each connection and keep write transactions short. Multiple readers can coexist, but only one write transaction can run at a time.
- Reuse a server-side database connection within the application process and use parameterized SQL for user-supplied values.
- Use checked-in, versioned SQL migrations for tables, indexes, constraints, and closure-protection triggers; record applied versions in the database.
- Run migrations once during deployment before starting the updated application, with application writes stopped and a backup taken first.
- Apply `002_superadmin.sql` as a versioned migration: rebuild the SQLite user role constraint while preserving every account, report ID/number, relationship, event, attachment and closure trigger. Disable foreign keys only around the migration transaction; run foreign-key verification before committing and restore enforcement afterward.
- Create daily consistent snapshots using the SQLite online backup API, not a raw copy of an active database file. Keep an off-server copy and retain 30 daily backups.
- Preserve committed photo objects through the database backup retention window and back up private object storage. Restore referenced attachments with the selected database snapshot.
- Test restoration into an isolated environment, including integrity checks, foreign-key checks, report timelines, closed-report restrictions, and attachment retrieval.
- Keep the database and storage intact across application restarts and release replacements. Monitor disk capacity, database-busy errors, and backup failures.

### 11.6 Complete backup and supervised restoration

Settings creates a queued background job. Use SQLite's online backup API for a consistent snapshot, then copy every committed compressed photo referenced by that snapshot from private local storage or configured S3. Missing objects fail the job. Stream a `.tar.gz` containing `database.sqlite`, `photos/` and a `PAINI-1` manifest with schema versions, creation time, record/file counts, sizes and SHA-256 checksums. Exclude environment files, infrastructure secrets, caches, logs and temporary/unattached uploads. Saved sessions/rate limits are removed. Show status, progress, completion time, size and an authenticated superadmin download; audit downloads. Archives contain personal data and password hashes and must be kept confidential.

Restore sequence:

1. Display configured `MAX_BACKUP_BYTES` (default 1 GiB) before choosing an archive. Enforce it during streamed upload, and align proxy limits.
2. Background validation streams extraction to a private staging directory. Reject path traversal, links, duplicates, unexpected files, unsupported schema, mismatched checksums, corrupt SQLite/foreign keys, untrusted schema/triggers and missing or invalid photos. Bound expanded size and file counts.
3. Show snapshot timestamp and counts. Require current-password verification and explicit confirmation of full replacement.
4. Set maintenance mode in the separate control database and drain request leases. Stop the Next.js child process through its supervisor.
5. Create a complete pre-restore recovery archive. Keep recovery audit/job state outside the application database being replaced.
6. Stage database and photos in a new generation (local directory or unique S3 prefix). Do not overwrite active data or old objects. Clear restored sessions.
7. Atomically select the staged storage generation in the control database; start a fresh application process and verify health before leaving maintenance mode.
8. Require fresh login using snapshot credentials. If activation/restart fails, reactivate the previous generation. If interrupted, supervisor startup uses the persisted recovery pointer to roll back. Keep recovery backups/old generations for operator rollback.

Full restoration returns all application data and credentials to the snapshot. Later changes—including report closures—will be absent. This is privileged disaster recovery, not an exception to permanent report closure in normal operation.

Run one `npm start` supervisor, not bare `next start`, for worker/restart coordination. Keep `CONTROL_DIR` and all storage generations on persistent private disk outside release directories. The independent control store is not replaced from uploaded backups. Schedule `npm run backup` to queue daily complete archives; copy off-server and retain 30 daily backups plus pre-restore recovery archives. Apply retention only after verifying archives and confirming no active/staged generation references the data. No automatic destructive retention is performed. OS/server administrators remain responsible for off-server encryption, retention, disk monitoring and deployment-specific S3 restore drills.

Implementation references: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [SQLite transactions](https://www.sqlite.org/lang_transaction.html), and [SQLite WAL](https://www.sqlite.org/wal.html).

## 12. Testing and acceptance criteria
### Bilingual and administration acceptance

- Password-policy toggle defaults on, persists across reload/restart/backup, and is writable only by superadmin. Test new/manual/CSV student accounts, warden creation and both role password resets with it on/off. Existing requirements are unchanged; superadmin bootstrap/recovery stay mandatory. Verify policy changes are audited.

- Fresh visits default to Malay; choice survives reload/navigation/login/logout. Switching retains text and selected compressed photos; test mobile and accessibility labels in both languages.
- Canonical statuses/categories, IDs/numbers, authored text and snapshots remain unchanged. Both dictionaries cover errors, notifications and Settings.
- Bootstrap creates exactly one superadmin, never resets existing credentials or promotes collisions; enforce first-login password change.
- Students/wardens cannot access Settings APIs. Superadmin cannot directly access reports, timelines, photos, locations, manual student management, operational dashboards or notifications.
- Verify warden create/edit/reset/deactivate/archive/restore; historical authorship survives and old sessions never revive.
- CSV tests cover omitted/blank contacts, BOM, quotes, commas, escapes, blank lines, malformed input, invalid passwords/email, username and student-ID collisions, concurrency rollback and retry idempotency. Inspect preview/error/audit for password leakage.
- Backup tests verify all referenced photos and no environment secrets, integrity and foreign keys, schemas/checksums, unsafe paths/types and missing objects. Restore local and S3-backed deployments in staging.
- Maintenance blocks requests during cutover. Test errors before/during activation and restart, recovery rollback, session invalidation, relationships, numbers and closure triggers. Actual hosting/S3 access must also be tested with deployment credentials.


### 12.1 Accounts

- Warden manually creates a student with valid unique credentials.
- First login and reset flows require password change.
- Duplicate student IDs and usernames are rejected.
- Password reset and account deactivation invalidate active sessions.
- Reactivation requires a fresh login.
- Students cannot create accounts, manage locations, or obtain warden privileges.

### 12.2 Multiple wardens

- Two different wardens can access reports across all three blocks.
- One warden can update a report previously updated by another.
- Each event displays the correct warden identity.
- Concurrent replies preserve both entries.
- Stale status transitions return a conflict rather than overwrite another warden's action.
- Any warden can close a report, and closure prevents changes by every other warden.

### 12.3 Locations

- Create three blocks with different numbers of levels and rooms.
- Verify empty blocks/levels, ordering, navigation, and correct parent linkage.
- Verify duplicate validation and identical room labels under different parents.
- Verify required block codes, uppercase normalization, uniqueness across active and archived blocks, and preservation of existing report numbers after code changes.
- Test renaming, archiving, and restoration without losing historical reports.
- Confirm unavailable rooms disappear from new-report and new-assignment options.

### 12.4 Reports and access

- Student reports a problem in a room other than their assigned room.
- Student sees only their reports, even when sharing a room with another student.
- Direct identifier and attachment requests cannot reveal another student's data.
- Wardens see complete room history, including closed reports and former residents' reports.
- Room reassignment does not change ownership or visibility.
- Submission retries do not create duplicate reports.
- Verify report IDs are unique across all blocks and levels and are used for relationships and API operations independently of report numbers.
- Verify five-digit report numbers and independent numbering per block/level, including different rooms sharing one level's sequence.
- Concurrent submissions must receive distinct report IDs and report numbers; retries must retain both original identifiers.
- Verify report-number counters continue through closure, location archiving/restoration, code changes, and year changes. Existing IDs and report numbers must remain unchanged.
- Test historical prefix collisions and numbering beyond 99999 without duplication or wraparound.

### 12.5 Permanent closure

- Closing requires an explanation and produces exactly one final event.
- Both roles are blocked from further report, event, status, and attachment mutations.
- Concurrent replies and upload finalization respect the closure transaction.
- Database guards reject ordinary application writes against closed history.
- Renaming a student or location does not alter a closed report's historical display.
- Viewing closed reports and marking notifications read remain allowed.
- A recurring problem can be submitted as a separate report, but cannot reopen the previous one.

### 12.6 Compression and photos

- Large and rotated photos become correctly oriented compressed WebP images.
- Stored files meet dimensions and byte-size limits and contain no GPS metadata.
- Corrupt files and attempts to bypass compression are rejected.
- Five-photo submissions work on phones without uploading originals.
- Processing failures preserve typed report content.
- Compressed close-ups remain useful for inspecting damaged locks, lights, and fixtures.
- Cleanup removes abandoned temporary uploads without touching committed attachments.

### 12.7 General usability

- Verify the exact PAINI system name appears on login and shared header/footer for all three roles, including password-change pages.
- Verify the expanded name remains readable without clipping or horizontal overflow on phones, and the authenticated brand link opens the correct dashboard.
- Verify students/wardens land on their dashboards and superadmin lands on Settings after login/password change.
- Verify student dashboard totals and activity cannot expose other students' reports, including direct aggregate requests.
- Verify all wardens see the same dorm-wide data with identical filters, regardless of report authorship or update history.
- Verify status counts sum to the total and are not inflated by multiple events or attachments.
- Verify location filters and dashboard links preserve the expected Reports filters, including archived locations.
- Verify oldest-report ordering, latest-event ordering, and empty dashboard states.
- Verify 30-day trend boundaries in Malaysia time, zero-activity days, and closure-duration calculations for reports created before the window.
- Verify successful updates and closures appear on refresh and move reports between the appropriate summary counts and lists.
- Verify notification counts, read states, and refresh behavior.
- Verify pagination and stable timeline ordering.
- Test slow networks, failed uploads, repeated clicks, and validation recovery.
- Check phone and desktop layouts, keyboard navigation, and accessible labels.

### 12.8 SQLite and single-server deployment

- Run the account, permissions, locations, reports, and attachment tests against SQLite.
- Test simultaneous writers using separate database connections, including two warden replies and closure racing with a reply or attachment finalization.
- Verify that contention within the timeout completes correctly, and contention beyond it returns a retryable error without partial writes or duplicates.
- Confirm closure triggers reject direct SQL mutations of closed reports and their events/attachments.
- Verify migrations work on a fresh database and an existing supported schema without losing data.
- Verify foreign-key enforcement and WAL configuration on application and maintenance connections.
- Restart and redeploy the app and confirm accounts, sessions, reports, and photo references persist.
- Restore a consistent database backup and its referenced photos; confirm integrity and closed-report immutability.

## 13. Implementation sequence

1. Establish Next.js App Router, SQLite configuration and migrations, session authentication, role checks, and secure warden provisioning.
2. Build Student Management with password changes, resets, and deactivation.
3. Build Locations with hierarchy validation and archive/restore behavior.
4. Build report creation, compressed private attachments, My Reports, and detail timelines.
5. Build student and shared warden dashboards, the Reports page, room history, replies, and status transitions.
6. Implement permanent closure, historical snapshots, and concurrency/database guards.
7. Add notifications, temporary-upload cleanup, pagination, and refresh behavior.
8. Complete permission, concurrency, image-processing, and end-to-end tests.
9. Configure real locations and wardens, verify staging, and prepare single-server deployment, persistent storage, and backup/restore procedures.

## 14. Launch, defaults, and version-one boundaries

Before launch:

- Configure the persistent server/VPS, HTTPS reverse proxy, SQLite path and connection settings, private object storage, authentication secrets, and cleanup schedule.
- Run versioned migrations before application startup and verify the database is outside the release directory.
- Provision individual warden accounts securely.
- Enter actual block names, levels, and room numbers.
- Create initial student accounts through Student Management.
- Verify the complete student submission → warden update → permanent closure flow in staging.
- Enable error logging without credentials and configure database and attachment backups.
- Verify restore procedures preserve report-to-attachment references and closed history.

Defaults:

- Bahasa Melayu interface by default, with persistent English option.
- Next.js App Router with TypeScript and SQLite through `better-sqlite3`.
- One application instance on a persistent server/VPS with local database storage.
- Malaysia time (Asia/Kuala_Lumpur) for display; UTC in storage.
- Three initial blocks with no fixed limit.
- Rooms only.
- All wardens have equal access across the dorm.
- In-app maintenance notifications.
- Manual student and room entry, plus superadmin CSV student registration.
- No deletion or reopening of closed reports.

Outside version one:

- Shared-area reporting.
- Native mobile apps.
- Technician accounts or exclusive warden assignment.
- Public student registration or invitation-based enrollment.
- Email or push maintenance alerts.
- Bulk room import or automatic room generation (student CSV import is included).
- Reopening closed reports.
