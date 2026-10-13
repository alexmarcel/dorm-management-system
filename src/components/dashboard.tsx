"use client";
import { useLocale } from "./language";
import Link from "next/link";
import { useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Clock3,
  CheckCheck,
  FileText,
  CircleDot,
  Bell,
} from "lucide-react";
import type { dashboard } from "@/lib/dashboard";
import { type User, type Locations, STATUSES, dateTime } from "@/lib/constants";
import { useData } from "@/lib/client";
import {
  PageTitle,
  Loading,
  ErrorBox,
  ReportRows,
  Empty,
  LocationSelect,
} from "./shared";
type Data = ReturnType<typeof dashboard>;
export default function Dashboard({ user }: { user: User }) {
  const { t, locale } = useLocale();

  const [filter, setFilter] = useState({ block: "", level: "", room: "" }),
    loc = useData<Locations>("locations");
  const params = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v),
  );
  const { data: d, error, refresh } = useData<Data>("dashboard?" + params);
  const reportLink = (extra: Record<string, string> = {}) =>
    "/reports?" +
    new URLSearchParams({ ...Object.fromEntries(params), ...extra });
  return (
    <>
      <PageTitle
        eyebrow={t("YOUR DORM, AT A GLANCE")}
        title={t("Hello, {name}.", { name: user.name.split(" ")[0] })}
        text={
          user.role === "warden"
            ? t("Here's what's happening across your dorm.")
            : t("A little care makes a better place to stay.")
        }
        action={
          <Link
            className="button"
            href={
              user.role === "warden"
                ? "/reports?status=Submitted"
                : "/reports/new"
            }
          >
            {user.role === "warden" ? (
              <FileText size={17} />
            ) : (
              <Plus size={17} />
            )}{" "}
            {user.role === "warden"
              ? t("Review reports")
              : t("Report a problem")}
          </Link>
        }
      />
      <ErrorBox message={error} />
      {error && <button onClick={refresh}>{t("Retry")}</button>}
      {user.role === "warden" && loc.data && (
        <div className="filter-bar">
          <LocationSelect
            locations={loc.data}
            value={filter}
            onChange={setFilter}
          />
          <span className="muted">{t("Current workload · all time")}</span>
        </div>
      )}
      {!d ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            {[
              { name: "Total reports", n: d.total, icon: FileText },
              ...STATUSES.map((s, i) => ({
                name: s,
                n: d.counts[s],
                icon: [CircleDot, Bell, Clock3, CheckCheck][i],
              })),
            ].map((s) => (
              <Link
                href={reportLink(
                  s.name === "Total reports" ? {} : { status: s.name },
                )}
                key={s.name}
                className={
                  "stat stat-" + s.name.toLowerCase().replaceAll(" ", "-")
                }
              >
                <div>
                  <span>{t(s.name)}</span>
                  <s.icon size={18} />
                </div>
                <strong>
                  {s.n.toLocaleString(locale === "ms" ? "ms-MY" : "en-MY")}
                </strong>
                <small>
                  {s.name === "Closed"
                    ? t("Completed & locked")
                    : t("View reports")}{" "}
                  <ArrowUpRight size={12} />
                </small>
              </Link>
            ))}
          </div>
          {user.role === "student" && (
            <div className="student-strip">
              <span>
                <strong>{t("Your room")}</strong>{" "}
                {d.assigned_room || t("Not assigned yet")}
                <small>{t("You can report a problem in any room.")}</small>
              </span>
              <Link href="/notifications">
                <Bell size={17} /> {d.unread} {t("unread updates")}
              </Link>
            </div>
          )}
          <div className="dashboard-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {user.role === "warden"
                      ? t("Needs attention")
                      : t("Your open reports")}
                  </h2>
                  <p>
                    {user.role === "warden"
                      ? t("Oldest reports waiting for acknowledgement")
                      : t("Your most recently updated reports")}
                  </p>
                </div>
                <Link
                  href={reportLink(
                    user.role === "warden"
                      ? { status: "Submitted" }
                      : { status: "Open" },
                  )}
                >
                  {t("View all")}
                  <ArrowUpRight size={15} />
                </Link>
              </div>
              <ReportRows
                items={user.role === "warden" ? d.attention : d.recent}
                compact
              />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{t("Latest activity")}</h2>
                  <p>
                    {user.role === "warden"
                      ? t("Updates from your dorm community")
                      : t("The latest from your wardens")}
                  </p>
                </div>
                <span className="live-dot">{t("Live")}</span>
              </div>
              {d.activity.length ? (
                <div className="activity-list">
                  {d.activity.map((e) => (
                    <Link
                      key={e.id}
                      href={"/reports/" + e.report_id}
                      className="activity"
                    >
                      <span className="activity-dot" />
                      <div>
                        <strong>{e.actor_name}</strong>
                        <p>{e.message}</p>
                        <small>
                          {e.report_number} · {dateTime(e.created_at, locale)}
                        </small>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  title={t("All quiet for now")}
                  text={t("New updates will appear here.")}
                />
              )}
            </section>
          </div>
          {user.role === "warden" && (
            <>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{t("Report activity")}</h2>
                      <p>
                        {t(
                          "Submissions and closures · last 30 days, Malaysia time",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i />
                      {t("Submitted")}
                    </span>
                    <span>
                      <i />
                      {t("Closed")}
                    </span>
                  </div>
                  <div
                    className="trend"
                    aria-label={t("Daily submissions and closures")}
                  >
                    {d.trend?.map((day) => {
                      const max = Math.max(
                        1,
                        ...d.trend!.flatMap((x) => [x.submitted, x.closed]),
                      );
                      return (
                        <div
                          key={day.day}
                          title={t(
                            "{day}: {submitted} submitted, {closed} closed",
                            {
                              day: day.day,
                              submitted: day.submitted,
                              closed: day.closed,
                            },
                          )}
                          className="trend-day"
                        >
                          <div>
                            <i
                              style={{
                                height: `${Math.max(2, (day.submitted / max) * 100)}%`,
                              }}
                            />
                            <i
                              style={{
                                height: `${Math.max(2, (day.closed / max) * 100)}%`,
                              }}
                            />
                          </div>
                          <span>{day.day.slice(8)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <details className="chart-data">
                    <summary>{t("View daily counts")}</summary>
                    <table>
                      <thead>
                        <tr>
                          <th>{t("Date")}</th>
                          <th>{t("Submitted")}</th>
                          <th>{t("Closed")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.trend?.map((t) => (
                          <tr key={t.day}>
                            <td>{t.day}</td>
                            <td>{t.submitted}</td>
                            <td>{t.closed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                  <div className="resolution">
                    <Clock3 />
                    <div>
                      <strong>
                        {d.averageHours === null
                          ? t("No closed reports")
                          : t("{count} hours", {
                              count: d.averageHours?.toFixed(1) || "0",
                            })}
                      </strong>
                      <small>
                        {t("Average time to close ·")} {d.closedCount}{" "}
                        {t("reports closed in the last 30 days")}
                      </small>
                    </div>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{t("Open workload")}</h2>
                      <p>{t("Where a little attention is needed")}</p>
                    </div>
                  </div>
                  <div className="breakdown">
                    <h3>{t("By block")}</h3>
                    {d.byBlock?.map((b) => (
                      <Link
                        href={reportLink({ block: b.id, status: "Open" })}
                        key={b.id}
                      >
                        <span>{b.name}</span>
                        <div>
                          <i
                            style={{
                              width: `${(b.count / Math.max(1, d.total - d.counts.Closed)) * 100}%`,
                            }}
                          />
                        </div>
                        <strong>{b.count}</strong>
                      </Link>
                    ))}
                    <h3>{t("By category")}</h3>
                    {d.byCategory?.length ? (
                      d.byCategory.map((c) => (
                        <Link
                          href={reportLink({
                            category: c.name,
                            status: "Open",
                          })}
                          key={c.name}
                        >
                          <span>{t(c.name)}</span>
                          <div>
                            <i
                              style={{
                                width: `${(c.count / Math.max(1, d.total - d.counts.Closed)) * 100}%`,
                              }}
                            />
                          </div>
                          <strong>{c.count}</strong>
                        </Link>
                      ))
                    ) : (
                      <p className="muted">{t("No reports yet.")}</p>
                    )}
                  </div>
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{t("Oldest open reports")}</h2>
                    <p>
                      {t(
                        "Sorted by submission date · no service deadline assigned",
                      )}
                    </p>
                  </div>
                </div>
                <ReportRows items={d.oldest} compact />
              </section>
              <div className="setup-strip">
                <div>
                  <h3>{t("Your dorm")}</h3>
                  <p>{t("Dorm-wide active totals")}</p>
                </div>
                {Object.entries(d.setup || {}).map(([name, n]) => (
                  <Link
                    href={name === "students" ? "/students" : "/locations"}
                    key={name}
                  >
                    <strong>{n}</strong>
                    <span>{t(name)}</span>
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
            </>
          )}
          <div className="refresh-note">
            {t("Updated")} {dateTime(d.refreshed_at, locale)}{" "}
            {t("· Refreshes every 30 seconds")}
          </div>
        </>
      )}
    </>
  );
}
