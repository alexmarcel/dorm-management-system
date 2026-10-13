"use client";
import { useLocale } from "./language";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { api, useData } from "@/lib/client";
import { dateTime } from "@/lib/constants";
import { PageTitle, Loading, ErrorBox, Pager, Empty } from "./shared";
interface Notice {
  id: string;
  report_id: string;
  report_number: string;
  message: string;
  created_at: string;
  read_at: string | null;
  kind: string;
}
export default function Notifications() {
  const { t, locale } = useLocale();

  const [page, setPage] = useState(1),
    { data, error, refresh } = useData<{
      items: Notice[];
      pages: number;
      unread: number;
    }>(`notifications?page=${page}`),
    [actionError, setActionError] = useState(""),
    router = useRouter();
  return (
    <>
      <PageTitle
        eyebrow={t("STAY IN THE LOOP")}
        title={t("Notifications")}
        text={t("Updates on the things that matter.")}
      />
      <ErrorBox message={error || actionError} />
      {error && <button onClick={refresh}>{t("Retry")}</button>}
      {!data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {data.unread} {t("unread updates")}
            </h2>
          </div>
          {data.items.length ? (
            data.items.map((n) => (
              <button
                key={n.id}
                className={"notification " + (!n.read_at ? "unread" : "")}
                onClick={async () => {
                  try {
                    await api("notifications/" + n.id, {});
                    router.push("/reports/" + n.report_id);
                  } catch (e) {
                    setActionError((e as Error).message);
                  }
                }}
              >
                <span className="report-icon">
                  <Bell size={19} />
                </span>
                <span>
                  <strong>
                    {n.report_number} <small>{t(n.kind)}</small>
                  </strong>
                  <p>{n.message}</p>
                  <time>{dateTime(n.created_at, locale)}</time>
                </span>
                {!n.read_at && <i />}
              </button>
            ))
          ) : (
            <Empty
              title={t("You're all caught up")}
              text={t("Report activity will appear here.")}
            />
          )}
          <Pager page={page} pages={data.pages} onChange={setPage} />
        </section>
      )}
    </>
  );
}
