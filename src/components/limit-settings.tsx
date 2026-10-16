"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { LIMIT_DEFINITIONS, type LimitSnapshot } from "@/lib/limit-definitions";
import { useLocale } from "./language";
import { ErrorBox, Loading } from "./shared";
import styles from "./settings.module.css";
const groups = [...new Set(LIMIT_DEFINITIONS.map((d) => d.group))];
const fields = (values: Record<string, number>) =>
  Object.fromEntries(
    LIMIT_DEFINITIONS.map((d) => [d.key, String(values[d.key] / d.scale)]),
  );
export default function LimitSettings() {
  const { t } = useLocale();
  const [snapshot, setSnapshot] = useState<LimitSnapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<LimitSnapshot>("settings/limits")
      .then((value) => {
        if (active) {
          setSnapshot(value);
          setDraft(fields(value.values));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function reload() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api<LimitSnapshot>("settings/limits");
      setSnapshot(value);
      setDraft(fields(value.values));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={"panel form " + styles.limitPanel}>
      <h2>{t("Quotas and limits")}</h2>
      <p className="muted">
        {t(
          "Changes apply to new requests immediately. Existing usage is not reset; current windows keep their expiry. New window lengths and photo expiry apply when a new window or upload begins.",
        )}
      </p>
      <p className="muted">
        {t(
          "Lower limits may block users who already reached them. Higher limits allow more resource usage. Photo safety ceilings remain 500 KB, 1600 pixels and five attachments; static WebP validation stays required.",
        )}
      </p>
      <ErrorBox message={error} />
      {message && (
        <p role="status" className="alert success">
          {t(message)}
        </p>
      )}
      {!snapshot ? (
        <>
          {!error && <Loading />}
          <button type="button" disabled={busy} onClick={reload}>
            {t("Reload saved values")}
          </button>
        </>
      ) : (
        <form
          className={styles.limitForm}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const values = Object.fromEntries(
                LIMIT_DEFINITIONS.map((d) => [
                  d.key,
                  Math.round(Number(draft[d.key]) * d.scale),
                ]),
              );
              const saved = await api<LimitSnapshot>("settings/limits", {
                revision: snapshot.revision,
                values,
              });
              setSnapshot(saved);
              setDraft(fields(saved.values));
              setMessage("Quotas and limits saved.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {groups.map((group) => (
            <fieldset key={group} disabled={busy} className={styles.limitGroup}>
              <legend>{t(group)}</legend>
              <div className={styles.limitGrid}>
                {LIMIT_DEFINITIONS.filter((d) => d.group === group).map((d) => (
                  <label key={d.key} htmlFor={d.key}>
                    <span id={d.key + "-label"}>{t(d.label)}</span>
                    <input
                      id={d.key}
                      type="number"
                      inputMode="decimal"
                      required
                      min={d.min / d.scale}
                      max={d.max / d.scale}
                      step={1 / d.scale}
                      value={draft[d.key] ?? ""}
                      onChange={(e) => {
                        setDraft({ ...draft, [d.key]: e.target.value });
                        setMessage("");
                      }}
                      aria-describedby={d.key + "-range"}
                      aria-labelledby={d.key + "-label"}
                    />
                    <small id={d.key + "-range"} className="muted">
                      {t("Allowed: {min} to {max}", {
                        min: d.min / d.scale,
                        max: d.max / d.scale,
                      })}
                    </small>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="muted">
            {t(
              "MB and KB use decimal units. Wardens cannot create reports; superadmins have a write quota but cannot submit reports or photos.",
            )}
          </p>
          <div className={styles.limitActions}>
            <button type="submit" disabled={busy}>
              {t("Save quotas and limits")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(fields(snapshot.defaults));
                setMessage("Default values loaded. Save to apply.");
              }}
            >
              {t("Use default values")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={reload}
            >
              {t("Reload saved values")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
