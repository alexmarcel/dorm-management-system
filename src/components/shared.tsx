"use client";
import { useLocale } from "./language";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  X,
  ChevronRight,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { type Locations, type Report, dateTime } from "@/lib/constants";
import { compress } from "@/lib/client";
export function ErrorBox({ message }: { message: string }) {
  const { t, locale } = useLocale();

  return message ? (
    <div className="alert error" role="alert">
      {t(message)}
    </div>
  ) : null;
}
export function Loading() {
  const { t, locale } = useLocale();

  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <p>{t("Loading PAINI…")}</p>
    </div>
  );
}
export function Empty({
  title = "Nothing here yet",
  text = "New activity will appear here.",
}: {
  title?: string;
  text?: string;
}) {
  const { t, locale } = useLocale();

  return (
    <div className="empty">
      <FileText size={28} />
      <h3>{t(title)}</h3>
      <p>{t(text)}</p>
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  const { t, locale } = useLocale();

  return (
    <span className={"badge " + status.toLowerCase().replaceAll(" ", "-")}>
      {t(status)}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  const { t, locale } = useLocale();

  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (n: number) => void;
}) {
  const { t, locale } = useLocale();

  return pages > 1 ? (
    <div className="pager">
      <button
        className="secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {t("Previous")}
      </button>
      <span>
        {t("Page")} {page} {t("of")} {pages}
      </span>
      <button
        className="secondary"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        {t("Next")}
      </button>
    </div>
  ) : null;
}
export function ReportRows({
  items,
  compact = false,
}: {
  items: Report[];
  compact?: boolean;
}) {
  const { t, locale } = useLocale();

  return items.length ? (
    <div className="report-list">
      {items.map((r) => (
        <Link className="report-row" href={"/reports/" + r.id} key={r.id}>
          <div className="report-icon">
            <FileText size={19} />
          </div>
          <div className="report-copy">
            <div className="report-number">{r.report_number}</div>
            <strong>{r.title}</strong>
            <p>{r.location}</p>
            {!compact && r.latest_message && (
              <p className="truncate">{r.latest_message}</p>
            )}
          </div>
          <div className="report-meta">
            <Badge status={r.status} />
            <small>{dateTime(r.updated_at, locale)}</small>
          </div>
          <ChevronRight size={17} />
        </Link>
      ))}
    </div>
  ) : (
    <Empty
      title={t("No reports found")}
      text={t("Reports matching these filters will appear here.")}
    />
  );
}
export function LocationSelect({
  locations,
  value,
  onChange,
  activeOnly = false,
  required = false,
}: {
  locations: Locations;
  value: { block: string; level: string; room: string };
  onChange: (v: { block: string; level: string; room: string }) => void;
  activeOnly?: boolean;
  required?: boolean;
}) {
  const { t, locale } = useLocale();

  const blocks = locations.blocks.filter(
    (b) =>
      !activeOnly ||
      (!b.archived &&
        locations.rooms.some((r) => r.available && r.block_id === b.id)),
  );
  const levels = locations.levels.filter(
    (l) =>
      l.block_id === value.block &&
      (!activeOnly ||
        (!l.archived &&
          locations.rooms.some((r) => r.available && r.level_id === l.id))),
  );
  const rooms = locations.rooms.filter(
    (r) => r.level_id === value.level && (!activeOnly || r.available),
  );
  return (
    <div className="location-select">
      <label>
        {t("Block")}
        <select
          aria-label={t("Block")}
          required={required}
          value={value.block}
          onChange={(e) =>
            onChange({ block: e.target.value, level: "", room: "" })
          }
        >
          <option value="">
            {required ? t("Select block") : t("All blocks")}
          </option>
          {blocks.map((b) => (
            <option value={b.id} key={b.id}>
              {b.name} ({b.code}){b.archived ? t(" · Archived") : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Level")}
        <select
          aria-label={t("Level")}
          required={required}
          disabled={!value.block}
          value={value.level}
          onChange={(e) =>
            onChange({ ...value, level: e.target.value, room: "" })
          }
        >
          <option value="">
            {required ? t("Select level") : t("All levels")}
          </option>
          {levels.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name} {l.archived ? t(" · Archived") : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Room")}
        <select
          aria-label={t("Room")}
          required={required}
          disabled={!value.level}
          value={value.room}
          onChange={(e) => onChange({ ...value, room: e.target.value })}
        >
          <option value="">
            {required ? t("Select room") : t("All rooms")}
          </option>
          {rooms.map((r) => (
            <option value={r.id} key={r.id}>
              {r.name} {!r.available ? t(" · Archived") : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
export interface PhotoDraft {
  name: string;
  blob: Blob;
  preview: string;
  uploaded?: string;
}
export function Photos({
  photos,
  setPhotos,
  busy,
  setBusy,
}: {
  photos: PhotoDraft[];
  setPhotos: (v: PhotoDraft[]) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const { t, locale } = useLocale();

  const [error, setError] = useState(""),
    urls = useRef<string[]>([]);
  useEffect(
    () => () => urls.current.forEach((u) => URL.revokeObjectURL(u)),
    [],
  );
  return (
    <div className="photos">
      <label>
        {t("Photos")}
        <span className="muted">{t("optional · up to 5")}</span>
      </label>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <div className="photo-preview" key={p.preview}>
            <img src={p.preview} alt={p.name} />
            <button
              type="button"
              disabled={busy}
              aria-label={t("Remove {name}", { name: p.name })}
              onClick={() => {
                URL.revokeObjectURL(p.preview);
                setPhotos(photos.filter((_, j) => i !== j));
              }}
            >
              <X size={15} />
            </button>
            <small>
              {Math.ceil(p.blob.size / 1000)} {t("KB")}
            </small>
          </div>
        ))}
      </div>
      <label className={"photo-drop " + (busy ? "disabled" : "")}>
        <ImagePlus size={24} />
        <strong>{busy ? t("Compressing photos…") : t("Choose photos")}</strong>
        <span>
          {t("JPEG, PNG or WebP · up to 20 MB each")}
          <br />
          {t("Automatically compressed before upload")}
        </span>
        <input
          aria-label={t("Choose photos")}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy || photos.length >= 5}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            setError("");
            if (files.length + photos.length > 5) {
              setError("Choose no more than five photos.");
              return;
            }
            setBusy(true);
            const added: PhotoDraft[] = [];
            try {
              for (const file of files) {
                const blob = await compress(file),
                  preview = URL.createObjectURL(blob);
                urls.current.push(preview);
                added.push({ name: file.name, blob, preview });
              }
              setPhotos([...photos, ...added]);
            } catch (err) {
              added.forEach((p) => URL.revokeObjectURL(p.preview));
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <ErrorBox message={error} />
    </div>
  );
}
export async function uploadPhotos(photos: PhotoDraft[]) {
  const ids: string[] = [];
  for (const p of photos) {
    if (!p.uploaded) {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "image/webp" },
        body: p.blob,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Photo upload failed.");
      p.uploaded = data.id;
    }
    ids.push(p.uploaded!);
  }
  return ids;
}
