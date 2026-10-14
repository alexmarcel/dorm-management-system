"use client";
import { useRef, useState } from "react";
import { api, useData } from "@/lib/client";
import { dateTime, type User } from "@/lib/constants";
import { useLocale } from "./language";
import { ErrorBox, PageTitle, Loading, Empty } from "./shared";
import styles from "./settings.module.css";
type Preview = {
  valid: boolean;
  count: number;
  errors: { row: number; field: string; code: string }[];
  rows: {
    fullname: string;
    username: string;
    student_id: string;
    "phone number": string;
    email: string;
  }[];
};
type Job = {
  id: string;
  kind: string;
  status: string;
  progress: number;
  created_at: string;
  updated_at: string;
  error: string | null;
  result?: {
    bytes?: number;
    manifest?: {
      created_at: string;
      records: Record<string, number>;
      files: unknown[];
    };
  };
};
export default function Settings() {
  const { t, locale } = useLocale(),
    [tab, setTab] = useState("Warden Accounts"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pendingPolicy, setPendingPolicy] = useState<boolean | null>(null),
    [message, setMessage] = useState("");
  const overview = useData<{
    counts: { role: string; count: number }[];
    worker: boolean;
    maxArchiveBytes: number;
    requireInitialPasswordChange: boolean;
  }>("settings");
  const [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    wardens = useData<User[]>(
      `settings/wardens?q=${encodeURIComponent(search)}&archived=${archived}`,
    ),
    jobs = useData<Job[]>("settings/jobs", 2000);
  const [edit, setEdit] = useState<Partial<User> | null>(null),
    [reset, setReset] = useState<User | null>(null),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [operationId, setOperationId] = useState(""),
    [importCount, setImportCount] = useState<number | null>(null),
    [archive, setArchive] = useState<File | null>(null),
    [restore, setRestore] = useState<Job | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function wardenAction(w: User, action: string) {
    await perform(async () => {
      await api("settings/wardens/" + w.id, { action });
      await wardens.refresh();
      await overview.refresh();
    });
  }
  return (
    <div className={styles.page}>
      <PageTitle
        eyebrow="PAINI"
        title={t("Settings and administration")}
        text={t("Manage accounts, student imports, and complete backups.")}
      />
      <div className="admin-counts">
        {overview.data?.counts.map((c) => (
          <span className="tag" key={c.role}>
            {t(c.role)}:{" "}
            {c.count.toLocaleString(locale === "ms" ? "ms-MY" : "en-MY")}
          </span>
        ))}
      </div>
      <div className="settings-tabs" role="tablist" aria-label={t("Settings")}>
        {["Warden Accounts", "Backup and Restore", "Student CSV Import"].map(
          (v) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab === v}
              className={tab === v ? "" : "secondary"}
              key={v}
              onClick={() => {
                setTab(v);
                setError("");
              }}
            >
              {t(v)}
            </button>
          ),
        )}
      </div>
      <ErrorBox message={error || overview.error} />
      {overview.data && (
        <section className="panel form">
          <h2>{t("Account security")}</h2>
          <label className="check-label">
            <input
              type="checkbox"
              checked={
                pendingPolicy ?? overview.data.requireInitialPasswordChange
              }
              disabled={busy}
              onChange={(e) => {
                const enabled = e.target.checked;
                if (
                  !enabled &&
                  !confirm(
                    t(
                      "Allow new and reset accounts to keep their supplied passwords?",
                    ),
                  )
                )
                  return;
                setPendingPolicy(enabled);
                void perform(async () => {
                  try {
                    await api("settings/security", {
                      requireInitialPasswordChange: enabled,
                    });
                    await overview.refresh();
                    setMessage("Password-change policy saved.");
                  } finally {
                    setPendingPolicy(null);
                  }
                });
              }}
            />
            {t("Require password change on first login")}
          </label>
          <p className="muted">
            {t(
              "Applies to newly created or reset student and warden accounts, including CSV imports. Existing requirements remain unchanged. Superadmin setup and recovery always require a password change.",
            )}
          </p>
        </section>
      )}
      {message && (
        <div role="status" className="alert success">
          {t(message)}
        </div>
      )}
      {tab === "Warden Accounts" && (
        <section className="panel">
          <div className="panel-heading">
            <h2>{t(tab)}</h2>
            <button
              disabled={busy}
              onClick={() => {
                setError("");
                setEdit({ active: 1 });
              }}
            >
              {t("Add warden")}
            </button>
          </div>
          <div className="filter-row">
            <label>
              {t("Search wardens")}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              {t("Show archived")}
            </label>
          </div>
          <ErrorBox message={wardens.error} />
          {!wardens.data ? (
            <Loading />
          ) : !wardens.data.length ? (
            <Empty title={t("No wardens found")} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "Full name",
                      "Username",
                      "Account status",
                      "Created",
                      "Actions",
                    ].map((v) => (
                      <th key={v}>{t(v)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wardens.data.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td>{w.username}</td>
                      <td>
                        {t(
                          w.archived_at
                            ? "Archived"
                            : w.active
                              ? "Active"
                              : "Inactive",
                        )}
                      </td>
                      <td>{dateTime(w.created_at!, locale)}</td>
                      <td>
                        <div className="row-actions">
                          {w.archived_at ? (
                            <button
                              disabled={busy}
                              onClick={() => wardenAction(w, "restore")}
                            >
                              {t("Restore account")}
                            </button>
                          ) : (
                            <>
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => setEdit(w)}
                              >
                                {t("Edit")}
                              </button>
                              <button
                                className="secondary"
                                disabled={busy}
                                onClick={() => setReset(w)}
                              >
                                {t("Reset password")}
                              </button>
                              <button
                                className="danger"
                                disabled={busy}
                                onClick={() => {
                                  if (
                                    confirm(
                                      t(
                                        "Archive this warden and revoke all sessions? Their report history will be preserved.",
                                      ),
                                    )
                                  )
                                    void wardenAction(w, "archive");
                                }}
                              >
                                {t("Archive account")}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === "Student CSV Import" && (
        <section className="panel form">
          <h2>{t(tab)}</h2>
          <p>
            {t(
              "CSV limit: 1,000 students and 2 MB. Required columns: fullname, username, password. Optional: phone number, email.",
            )}
          </p>
          <a className="button secondary" href="/api/settings/import/template">
            {t("Download template")}
          </a>
          <label>
            {t("Choose CSV")}
            <input
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                setCsv("");
                setPreview(null);
                setImportCount(null);
                setOperationId(crypto.randomUUID());
                if (file)
                  void perform(async () => {
                    if (file.size > 2 * 1024 * 1024)
                      throw new Error("CSV files must be 2 MB or smaller.");
                    const bytes = await file.arrayBuffer();
                    setCsv(
                      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                    );
                  });
              }}
            />
          </label>
          <p>
            {t(
              "Passwords are hidden and never retained in the preview. Existing accounts will not be overwritten.",
            )}
          </p>
          <button
            disabled={!csv || busy}
            onClick={() =>
              perform(async () =>
                setPreview(
                  await api<Preview>("settings/import/preview", { csv }),
                ),
              )
            }
          >
            {t(busy ? "Validating…" : "Validate CSV")}
          </button>
          {importCount !== null && (
            <div className="alert success" role="status">
              {t("{count} students imported.", { count: importCount })}
            </div>
          )}
          {preview && (
            <>
              <h3>{t("{count} valid rows", { count: preview.count })}</h3>
              {preview.errors.length > 0 && (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {["Row", "Field", "Problem"].map((v) => (
                          <th key={v}>{t(v)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((e, i) => (
                        <tr key={i}>
                          <td>{e.row}</td>
                          <td>{t(e.field)}</td>
                          <td>{t(e.code)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="table-scroll import-preview">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Full name",
                        "Username",
                        "Student ID",
                        "Phone number",
                        "Email",
                      ].map((v) => (
                        <th key={v}>{t(v)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.fullname}</td>
                        <td>{r.username}</td>
                        <td>{r.student_id}</td>
                        <td>{r["phone number"]}</td>
                        <td>{r.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                disabled={busy || !preview.valid}
                onClick={() =>
                  perform(async () => {
                    const d = await api<{ count: number }>(
                      "settings/import/commit",
                      { csv, operationId },
                    );
                    setImportCount(d.count);
                    setCsv("");
                    setPreview(null);
                    if (csvInput.current) csvInput.current.value = "";
                    await overview.refresh();
                  })
                }
              >
                {t(busy ? "Importing…" : "Confirm import")}
              </button>
            </>
          )}
        </section>
      )}
      {tab === "Backup and Restore" && (
        <section className="panel form">
          <h2>{t(tab)}</h2>
          <p>
            {t(
              "Backups include the database and committed photos. Keep downloaded archives confidential.",
            )}
          </p>
          <span className="tag">
            {t(overview.data?.worker ? "Worker online" : "Worker offline")}
          </span>
          <button
            disabled={busy || !overview.data?.worker}
            onClick={() =>
              perform(async () => {
                await api("settings/backup", {});
                await jobs.refresh();
              })
            }
          >
            {t("Create backup")}
          </button>
          <div className="divider" />
          <h3>{t("Upload backup")}</h3>
          <p>
            {t("Maximum upload: {size} MB", {
              size: Math.floor(
                (overview.data?.maxArchiveBytes || 0) / 1024 / 1024,
              ),
            })}
          </p>
          <label>
            {t("Upload backup")}
            <input
              type="file"
              accept=".gz,.tgz,application/gzip"
              disabled={busy}
              onChange={(e) => {
                setError("");
                const f = e.target.files?.[0] || null;
                if (f && f.size > (overview.data?.maxArchiveBytes || 0)) {
                  setError("Backup archive is too large.");
                  setArchive(null);
                  e.target.value = "";
                } else setArchive(f);
              }}
            />
          </label>
          <button
            disabled={busy || !archive || !overview.data?.worker}
            onClick={() =>
              perform(async () => {
                const r = await fetch("/api/settings/restore/upload", {
                  method: "POST",
                  headers: { "Content-Type": "application/gzip" },
                  body: archive,
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.code || d.error);
                setArchive(null);
                await jobs.refresh();
              })
            }
          >
            {t(busy ? "Validating…" : "Validate backup")}
          </button>
          <ErrorBox message={jobs.error} />
          {!jobs.data ? (
            <Loading />
          ) : !jobs.data.length ? (
            <Empty title={t("No operations yet")} />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "Operation",
                      "Created",
                      "Status",
                      "Progress",
                      "Actions",
                    ].map((v) => (
                      <th key={v}>{t(v)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.map((j) => (
                    <tr key={j.id}>
                      <td>{t(j.kind)}</td>
                      <td>
                        {dateTime(j.created_at, locale)}
                        {["ready", "complete", "failed"].includes(j.status) && (
                          <small>
                            {t("Completed")}: {dateTime(j.updated_at, locale)}
                          </small>
                        )}
                      </td>
                      <td>
                        {t(j.status)}
                        {j.error && <ErrorBox message={j.error} />}
                      </td>
                      <td>
                        {j.progress}%
                        {j.result?.bytes && (
                          <small>
                            {(j.result.bytes / 1024 / 1024).toFixed(2)} MB
                          </small>
                        )}
                      </td>
                      <td>
                        {j.kind === "backup" && j.status === "complete" && (
                          <a
                            className="button secondary"
                            href={`/api/settings/backups/${j.id}/download`}
                          >
                            {t("Download")}
                          </a>
                        )}
                        {j.kind === "validate" && j.status === "ready" && (
                          <>
                            <small>
                              {dateTime(j.result!.manifest!.created_at, locale)}
                            </small>
                            <dl className="backup-counts">
                              {Object.entries(
                                j.result?.manifest?.records || {},
                              ).map(([key, count]) => (
                                <div key={key}>
                                  <dt>{t(key)}</dt>
                                  <dd>{count}</dd>
                                </div>
                              ))}
                              <div>
                                <dt>{t("Files")}</dt>
                                <dd>{j.result?.manifest?.files.length}</dd>
                              </div>
                            </dl>
                            <button
                              disabled={busy}
                              onClick={() => setRestore(j)}
                            >
                              {t("Restore this backup")}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {(edit || reset) && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="warden-title"
          >
            <div className="panel-heading">
              <h2 id="warden-title">
                {t(
                  reset
                    ? "Reset password"
                    : edit?.id
                      ? "Edit warden"
                      : "Add warden",
                )}
              </h2>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEdit(null);
                  setReset(null);
                }}
              >
                {t("Cancel")}
              </button>
            </div>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  await api(
                    "settings/wardens" +
                      (edit?.id || reset?.id
                        ? "/" + (edit?.id || reset?.id)
                        : ""),
                    reset
                      ? { action: "reset", password: f.get("password") }
                      : {
                          name: f.get("name"),
                          username: f.get("username"),
                          active: f.get("active") === "true",
                          ...(!edit?.id ? { password: f.get("password") } : {}),
                        },
                  );
                  setEdit(null);
                  setReset(null);
                  await wardens.refresh();
                  await overview.refresh();
                });
              }}
            >
              {!reset && (
                <>
                  <label>
                    {t("Full name")}
                    <input
                      name="name"
                      defaultValue={edit?.name}
                      required
                      maxLength={200}
                    />
                  </label>
                  <label>
                    {t("Username")}
                    <input
                      name="username"
                      defaultValue={edit?.username}
                      required
                      pattern="[A-Za-z0-9_.-]{3,60}"
                      maxLength={60}
                    />
                  </label>
                  <label>
                    {t("Account status")}
                    <select name="active" defaultValue={String(!!edit?.active)}>
                      <option value="true">{t("Active")}</option>
                      <option value="false">{t("Inactive")}</option>
                    </select>
                  </label>
                </>
              )}
              {(reset || !edit?.id) && (
                <label>
                  {t("Temporary password")}
                  <input
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                  />
                  <small>{t("At least 8 characters.")}</small>
                </label>
              )}
              <ErrorBox message={error} />
              <button disabled={busy}>
                {t(busy ? "Saving…" : reset ? "Reset password" : "Save warden")}
              </button>
            </form>
          </section>
        </div>
      )}
      {restore && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
          >
            <h2 id="restore-title">{t("Restore confirmation")}</h2>
            <p>
              {t(
                "Restoring replaces the database and photos. Changes after this backup will be lost, including later report closures. All sessions will end.",
              )}
            </p>
            <p>{dateTime(restore.result!.manifest!.created_at, locale)}</p>
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(async () => {
                  await api("settings/restore/confirm", {
                    validationId: restore.id,
                    password: f.get("password"),
                    confirm: true,
                  });
                  setRestore(null);
                  setMessage(
                    "Restore requested. The app will restart; sign in using the credentials from the backup.",
                  );
                  await jobs.refresh();
                });
              }}
            >
              <label>
                {t("Current password")}
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </label>
              <label className="check-label">
                <input type="checkbox" required />
                {t(
                  "I understand all current data and account credentials will return to this snapshot.",
                )}
              </label>
              <ErrorBox message={error} />
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setRestore(null)}
                >
                  {t("Cancel")}
                </button>
                <button className="danger" disabled={busy}>
                  {t(busy ? "Starting…" : "Start restore")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
