"use client";
import { useLocale } from "./language";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, LockKeyhole, Send, FileText } from "lucide-react";
import {
  type User,
  type Locations,
  type Report,
  type TimelineEvent,
  STATUSES,
  CATEGORIES,
  dateTime,
} from "@/lib/constants";
import { api, useData } from "@/lib/client";
import {
  PageTitle,
  Loading,
  ErrorBox,
  ReportRows,
  Pager,
  Badge,
  LocationSelect,
  Photos,
  uploadPhotos,
  type PhotoDraft,
} from "./shared";
export function Reports({ user }: { user: User }) {
  const { t, locale } = useLocale();

  const search = useSearchParams(),
    router = useRouter(),
    params = new URLSearchParams(search.toString());
  const { data, error, refresh } = useData<{
      items: Report[];
      pages: number;
      page: number;
      total: number;
    }>("reports?" + params),
    loc = useData<Locations>("locations");
  const [students, setStudents] = useState<
    { id: string; name: string; student_id: string }[]
  >([]);
  useEffect(() => {
    if (user.role === "warden")
      api<{ id: string; name: string; student_id: string }[]>(
        "students/options",
      )
        .then(setStudents)
        .catch(() => {});
  }, [user.role]);
  const update = (values: Record<string, string>) => {
    const p = new URLSearchParams(params);
    p.delete("page");
    for (const [k, v] of Object.entries(values)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.push("/reports?" + p);
  };
  return (
    <>
      <PageTitle
        eyebrow={t("MAINTENANCE")}
        title={user.role === "warden" ? t("Reports") : t("My reports")}
        text={
          user.role === "warden"
            ? t("Every issue, every update, in one place.")
            : t("Follow the progress of your room maintenance reports.")
        }
        action={
          user.role === "student" ? (
            <Link className="button" href="/reports/new">
              <Plus size={17} />
              {t("New report")}
            </Link>
          ) : undefined
        }
      />
      <div className="panel filters">
        {loc.data && user.role === "warden" && (
          <LocationSelect
            locations={loc.data}
            value={{
              block: params.get("block") || "",
              level: params.get("level") || "",
              room: params.get("room") || "",
            }}
            onChange={update}
          />
        )}
        <div className="filter-row">
          <label>
            {t("Search")}
            <input
              placeholder={t("Report number or title")}
              defaultValue={params.get("q") || ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") update({ q: e.currentTarget.value });
              }}
              onBlur={(e) => {
                if (e.target.value !== (params.get("q") || ""))
                  update({ q: e.target.value });
              }}
            />
          </label>
          <label>
            {t("Status")}
            <select
              value={params.get("status") || ""}
              onChange={(e) => update({ status: e.target.value })}
            >
              <option value="">{t("All statuses")}</option>
              <option value="Open">{t("Open")}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Category")}
            <select
              value={params.get("category") || ""}
              onChange={(e) => update({ category: e.target.value })}
            >
              <option value="">{t("All categories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </label>
          {user.role === "warden" && (
            <label>
              {t("Reporting student")}
              <select
                value={params.get("student") || ""}
                onChange={(e) => update({ student: e.target.value })}
              >
                <option value="">{t("All students")}</option>
                {students.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name} ({s.student_id})
                  </option>
                ))}
              </select>
            </label>
          )}{" "}
          {params.toString() && (
            <button
              className="secondary"
              onClick={() => router.push("/reports")}
            >
              {t("Clear filters")}
            </button>
          )}
        </div>
      </div>
      <ErrorBox message={error} />
      {error && <button onClick={refresh}>{t("Retry")}</button>}
      {data ? (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {data.total} {data.total === 1 ? t("report") : t("reports")}
            </h2>
            <span className="muted">{t("Newest first")}</span>
          </div>
          <ReportRows items={data.items} />
          <Pager
            page={data.page}
            pages={data.pages}
            onChange={(n) => {
              const p = new URLSearchParams(params);
              p.set("page", String(n));
              router.push("/reports?" + p);
            }}
          />
        </section>
      ) : (
        <Loading />
      )}
    </>
  );
}
export function NewReport({ user }: { user: User }) {
  const { t, locale } = useLocale();

  const { data: loc, error: loadError } = useData<Locations>("locations"),
    router = useRouter();
  const [location, setLocation] = useState({ block: "", level: "", room: "" }),
    [initialized, setInitialized] = useState(false),
    [photos, setPhotos] = useState<PhotoDraft[]>([]),
    [processing, setProcessing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [key] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (loc && !initialized) {
      const room = loc.rooms.find((r) => r.id === user.room_id && r.available);
      if (room)
        setLocation({
          block: room.block_id,
          level: room.level_id,
          room: room.id,
        });
      setInitialized(true);
    }
  }, [loc, initialized, user.room_id]);
  return (
    <>
      <Link href="/reports" className="back">
        <ArrowLeft size={16} />
        {t("My reports")}
      </Link>
      <PageTitle
        eyebrow={t("LET'S GET IT FIXED")}
        title={t("Report a problem")}
        text={t("Tell us what's wrong. Your wardens will take it from here.")}
      />
      <div className="form-layout">
        <form
          className="panel form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const ids = await uploadPhotos(photos),
                result = await api<{ id: string }>("reports", {
                  room_id: location.room,
                  title: f.get("title"),
                  category: f.get("category"),
                  description: f.get("description"),
                  photos: ids,
                  submission_key: key,
                });
              router.push("/reports/" + result.id);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <h2>{t("Where is the problem?")}</h2>
            {loc ? (
              <LocationSelect
                locations={loc}
                value={location}
                onChange={setLocation}
                activeOnly
                required
              />
            ) : (
              <Loading />
            )}
            <ErrorBox message={loadError} />
            <div className="divider" />
            <h2>{t("What happened?")}</h2>
            <label>
              {t("Report title")}
              <input
                name="title"
                required
                maxLength={200}
                placeholder={t("e.g. The door lock won't turn")}
              />
            </label>
            <label>
              {t("Category")}
              <select
                aria-label={t("Category")}
                name="category"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  {t("Select a category")}
                </option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Description")}
              <textarea
                name="description"
                required
                maxLength={10000}
                rows={5}
                placeholder={t("Describe the problem and when you noticed it…")}
              />
            </label>
            <Photos
              photos={photos}
              setPhotos={setPhotos}
              busy={processing || busy}
              setBusy={setProcessing}
            />
            <ErrorBox message={error} />
            <div className="form-actions">
              <Link href="/reports" className="button secondary">
                {t("Cancel")}
              </Link>
              <button disabled={busy || processing || !loc}>
                <Send size={16} />
                {busy ? t("Submitting…") : t("Submit report")}
              </button>
            </div>
          </fieldset>
        </form>
        <aside className="info-card">
          <FileText size={28} />
          <h3>{t("A helpful report goes a long way.")}</h3>
          <p>
            {t(
              "Choose the room where the issue is happening. It can be any active room in the dorm.",
            )}
          </p>
          <p>
            {t(
              "A clear description and a close-up photo help wardens understand the problem.",
            )}
          </p>
          <div className="divider" />
          <strong>{t("Your report is private.")}</strong>
          <p>{t("Only you and the wardens can see your report and photos.")}</p>
        </aside>
      </div>
    </>
  );
}
export function ReportDetail({ user, id }: { user: User; id: string }) {
  const { t, locale } = useLocale();

  const [page, setPage] = useState(1),
    { data, error, refresh } = useData<{
      report: Report;
      events: TimelineEvent[];
      pages: number;
      total: number;
    }>(`reports/${id}?page=${page}`);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]),
    [processing, setProcessing] = useState(false),
    [busy, setBusy] = useState(false),
    [submitError, setSubmitError] = useState(""),
    [status, setStatus] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID());
  if (!data)
    return (
      <>
        <ErrorBox message={error} />
        {error ? <button onClick={refresh}>{t("Retry")}</button> : <Loading />}
      </>
    );
  const r = data.report;
  return (
    <>
      <Link href="/reports" className="back">
        <ArrowLeft size={16} />
        {t("Reports")}
      </Link>
      <PageTitle
        eyebrow={r.report_number}
        title={r.title}
        text={r.location}
        action={<Badge status={r.status} />}
      />
      <div className="report-detail-grid">
        <div>
          <section className="panel report-summary">
            <div className="panel-heading">
              <h2>{t("Report details")}</h2>
              <span className="tag">{t(r.category)}</span>
            </div>
            <p className="preserve">{r.description}</p>
            <div className="detail-meta">
              <span>
                {t("Reported by")}
                <strong>{r.creator_name}</strong>
              </span>
              <span>{dateTime(r.created_at, locale)}</span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Report timeline")}</h2>
                <p>{t("Every update, from start to finish.")}</p>
              </div>
              <span className="muted">
                {data.total} {t("events")}
              </span>
            </div>
            <div className="timeline">
              {data.events.map((e) => (
                <article key={e.id} className="timeline-event">
                  <span
                    className={
                      "timeline-dot " +
                      (e.new_status === "Closed" ? "closed" : "")
                    }
                  />
                  <div className="timeline-heading">
                    <strong>{e.actor_name}</strong>
                    <span className="tag">{t(e.actor_role)}</span>
                    <time>{dateTime(e.created_at, locale)}</time>
                  </div>
                  {e.new_status && (
                    <div className="timeline-status">
                      <Badge status={e.new_status} />
                      <small>{t(e.kind)}</small>
                    </div>
                  )}
                  <p className="preserve">{e.message}</p>
                  {e.attachments.length > 0 && (
                    <div className="attachments">
                      {e.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={"/api/photos/" + a.id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={"/api/photos/" + a.id}
                            alt={t("Maintenance report attachment")}
                            loading="lazy"
                          />
                          <small>
                            {Math.ceil(a.bytes / 1000)} {t("KB · View photo")}
                          </small>
                        </a>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <Pager page={page} pages={data.pages} onChange={setPage} />
          </section>
          {r.status === "Closed" ? (
            <div className="closed-notice">
              <LockKeyhole size={24} />
              <div>
                <strong>{t("This report is permanently closed.")}</strong>
                <p>
                  {t(
                    "No further changes or replies are allowed. If the issue returns, submit a new report.",
                  )}
                </p>
                {user.role === "student" && (
                  <Link href="/reports/new">{t("Create a new report →")}</Link>
                )}
              </div>
            </div>
          ) : (
            <form
              className="panel form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  status === "Closed" &&
                  !confirm(
                    t(
                      "Close this report permanently? No one will be able to reply, edit, or reopen it.",
                    ),
                  )
                )
                  return;
                const form = e.currentTarget,
                  f = new FormData(form);
                setBusy(true);
                setSubmitError("");
                try {
                  const ids = await uploadPhotos(photos);
                  await api(`reports/${id}/events`, {
                    message: f.get("message"),
                    ...(status ? { status, expected_status: r.status } : {}),
                    photos: ids,
                    submission_key: key,
                  });
                  form.reset();
                  setPhotos([]);
                  setStatus("");
                  setKey(crypto.randomUUID());
                  setPage(Math.ceil((data.total + 1) / 20));
                  await refresh();
                } catch (err) {
                  setSubmitError((err as Error).message);
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <fieldset disabled={busy}>
                <h2>
                  {user.role === "warden"
                    ? t("Post an update")
                    : t("Add a reply")}
                </h2>
                {user.role === "warden" && (
                  <label>
                    {t("Status")}
                    <select
                      aria-label={t("Status")}
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">
                        {t("Keep current status ·")} {t(r.status)}
                      </option>
                      {STATUSES.filter(
                        (s) => STATUSES.indexOf(s) > STATUSES.indexOf(r.status),
                      ).map((s) => (
                        <option key={s} value={s}>
                          {t(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {status === "Closed"
                    ? t("Closing explanation")
                    : t("Message")}
                  <textarea
                    name="message"
                    required
                    rows={4}
                    maxLength={10000}
                    placeholder={
                      status === "Closed"
                        ? t("Explain how the issue was resolved…")
                        : t("Share a progress update or additional details…")
                    }
                  />
                </label>
                <Photos
                  photos={photos}
                  setPhotos={setPhotos}
                  busy={processing || busy}
                  setBusy={setProcessing}
                />
                <ErrorBox message={submitError} />
                <button
                  disabled={busy || processing}
                  className={status === "Closed" ? "danger" : ""}
                >
                  {busy
                    ? t("Saving…")
                    : status === "Closed"
                      ? t("Close report permanently")
                      : t("Post update")}
                </button>
              </fieldset>
            </form>
          )}
        </div>
        <aside className="info-card">
          <h3>{t("At a glance")}</h3>
          <dl>
            <dt>{t("Report number")}</dt>
            <dd>{r.report_number}</dd>
            <dt>{t("Location")}</dt>
            <dd>{r.location}</dd>
            <dt>{t("Category")}</dt>
            <dd>{t(r.category)}</dd>
            <dt>{t("Last updated")}</dt>
            <dd>{dateTime(r.updated_at, locale)}</dd>
            {r.closed_at && (
              <>
                <dt>{t("Closed")}</dt>
                <dd>{dateTime(r.closed_at, locale)}</dd>
              </>
            )}
          </dl>
          {user.role === "warden" && (
            <Link href={"/reports?room=" + r.room_id}>
              {t("View full room history →")}
            </Link>
          )}
        </aside>
      </div>
    </>
  );
}
