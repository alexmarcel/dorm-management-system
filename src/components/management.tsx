"use client";
import { useLocale } from "./language";
import Link from "next/link";
import { useState } from "react";
import {
  Building2,
  Layers3,
  DoorOpen,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  ChevronRight,
  X,
  Users,
  KeyRound,
} from "lucide-react";
import { api, useData } from "@/lib/client";
import { type Locations, type User } from "@/lib/constants";
import {
  PageTitle,
  Loading,
  ErrorBox,
  Empty,
  LocationSelect,
  Pager,
} from "./shared";
interface LocationDraft {
  id?: string;
  name: string;
  code?: string;
  sort_order?: number;
  archived?: number;
}
export function LocationsPage() {
  const { t, locale } = useLocale();

  const { data, error, refresh } = useData<Locations>("locations"),
    [block, setBlock] = useState(""),
    [level, setLevel] = useState(""),
    [edit, setEdit] = useState<LocationDraft | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const kind = level ? "rooms" : block ? "levels" : "blocks",
    singular = level ? "room" : block ? "level" : "block",
    Icon = level ? DoorOpen : block ? Layers3 : Building2;
  const parentBlock = data?.blocks.find((b) => b.id === block),
    parentLevel = data?.levels.find((l) => l.id === level),
    parentArchived = !!parentBlock?.archived || !!parentLevel?.archived;
  const items: LocationDraft[] = data
    ? level
      ? data.rooms.filter((r) => r.level_id === level)
      : block
        ? data.levels.filter((l) => l.block_id === block)
        : data.blocks
    : [];
  async function archive(item: LocationDraft) {
    if (!data) return;
    const levels =
      kind === "blocks"
        ? data.levels.filter((l) => l.block_id === item.id)
        : [];
    const rooms =
      kind === "blocks"
        ? data.rooms.filter((r) => r.block_id === item.id)
        : kind === "levels"
          ? data.rooms.filter((r) => r.level_id === item.id)
          : [];
    if (
      !confirm(
        item.archived
          ? t(
              "Restore this location? Descendants independently archived will remain archived.",
            )
          : t(
              "Archive {name}? {levels} levels and {rooms} rooms will be affected. Existing reports remain available.",
              { name: item.name, levels: levels.length, rooms: rooms.length },
            ),
      )
    )
      return;
    setMessage("");
    try {
      await api("locations/" + kind, { ...item, archived: !item.archived });
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow={t("DORM SETUP")}
        title={t("Locations")}
        text={t("A place for every block, level, and room.")}
        action={
          <button
            disabled={parentArchived}
            onClick={() => {
              setMessage("");
              setEdit({ name: "", code: "", sort_order: 0, archived: 0 });
            }}
          >
            <Plus size={17} />
            {t("Add")} {t(singular)}
          </button>
        }
      />
      <div className="breadcrumbs">
        <button
          onClick={() => {
            setBlock("");
            setLevel("");
          }}
        >
          {t("All blocks")}
        </button>
        {block && (
          <>
            <ChevronRight size={15} />
            <button onClick={() => setLevel("")}>{parentBlock?.name}</button>
          </>
        )}{" "}
        {level && (
          <>
            <ChevronRight size={15} />
            <span>{parentLevel?.name}</span>
          </>
        )}
      </div>
      <ErrorBox message={error || message} />
      {parentArchived && (
        <div className="alert">
          {t(
            "This parent is archived. Restore it before adding new locations.",
          )}
        </div>
      )}
      {!data ? (
        <Loading />
      ) : items.length ? (
        <div className="location-grid">
          {items.map((item) => {
            const rooms =
              kind === "blocks"
                ? data.rooms.filter((r) => r.block_id === item.id)
                : data.rooms.filter((r) => r.level_id === item.id);
            return (
              <article
                className={"location-card " + (item.archived ? "archived" : "")}
                key={item.id}
              >
                <div className="location-card-top">
                  <span className="location-icon">
                    <Icon size={24} />
                  </span>
                  <span className="tag">
                    {item.archived ? t("Archived") : item.code || t("Room")}
                  </span>
                </div>
                <h2>{item.name}</h2>
                <p>
                  {kind === "blocks"
                    ? t("{levels} levels · {rooms} rooms", {
                        levels: data.levels.filter(
                          (l) => l.block_id === item.id,
                        ).length,
                        rooms: rooms.length,
                      })
                    : kind === "levels"
                      ? t("{count} rooms", { count: rooms.length })
                      : t("Room maintenance history")}
                </p>
                <div className="location-card-bottom">
                  {kind === "rooms" ? (
                    <Link href={"/reports?room=" + item.id}>
                      {t("View reports")}
                      <ChevronRight size={15} />
                    </Link>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => {
                        if (kind === "blocks") {
                          setBlock(item.id!);
                          setLevel("");
                        } else setLevel(item.id!);
                      }}
                    >
                      {t("Explore")}{" "}
                      {kind === "blocks" ? t("levels") : t("rooms")}{" "}
                      <ChevronRight size={15} />
                    </button>
                  )}
                  <div>
                    <button
                      className="icon-button"
                      aria-label={t("Edit {name}", { name: item.name })}
                      onClick={() => {
                        setMessage("");
                        setEdit(item);
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t(
                        item.archived ? "Restore {name}" : "Archive {name}",
                        { name: item.name },
                      )}
                      onClick={() => archive(item)}
                    >
                      {item.archived ? (
                        <RotateCcw size={16} />
                      ) : (
                        <Archive size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <Empty
            title={t("No {kind} yet", { kind: t(kind) })}
            text={t("Add a {kind} to start organizing this location.", {
              kind: t(singular),
            })}
          />
        </section>
      )}
      {edit && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="location-title"
          >
            <div className="panel-heading">
              <h2 id="location-title">
                {edit.id ? t("Edit") : t("Add")} {t(singular)}
              </h2>
              <button
                disabled={busy}
                className="icon-button"
                aria-label={t("Close dialog")}
                onClick={() => setEdit(null)}
              >
                <X />
              </button>
            </div>
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setMessage("");
                try {
                  await api("locations/" + kind, {
                    id: edit.id,
                    name: f.get("name"),
                    ...(kind !== "rooms" ? { code: f.get("code") } : {}),
                    sort_order: Number(f.get("sort_order") || 0),
                    archived: !!edit.archived,
                    parent_id: level || block || undefined,
                  });
                  setEdit(null);
                  await refresh();
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {t("{kind} name", {
                  kind: t(singular[0].toUpperCase() + singular.slice(1)),
                })}
                <input
                  name="name"
                  defaultValue={edit.name}
                  required
                  maxLength={200}
                  autoFocus
                  placeholder={
                    kind === "blocks"
                      ? t("e.g. Red Block")
                      : kind === "levels"
                        ? t("e.g. Ground Floor")
                        : t("e.g. G-01")
                  }
                />
              </label>
              {kind !== "rooms" && (
                <label>
                  {t("Code")}
                  <input
                    name="code"
                    defaultValue={edit.code}
                    required
                    pattern="[A-Za-z0-9]{1,20}"
                    maxLength={20}
                    placeholder={
                      kind === "blocks" ? t("e.g. RED") : t("e.g. G")
                    }
                  />
                  <small>
                    {t("Letters and numbers only. Used in report numbers.")}
                  </small>
                </label>
              )}{" "}
              {kind === "levels" && (
                <label>
                  {t("Display order")}
                  <input
                    type="number"
                    name="sort_order"
                    min={-100}
                    max={1000}
                    defaultValue={edit.sort_order || 0}
                  />
                </label>
              )}
              <ErrorBox message={message} />
              <button disabled={busy}>
                {busy ? t("Saving…") : t("Save {kind}", { kind: t(singular) })}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
export function StudentsPage() {
  const { t, locale } = useLocale();

  const [filters, setFilters] = useState({
      block: "",
      level: "",
      room: "",
      q: "",
      active: "",
    }),
    [page, setPage] = useState(1),
    params = new URLSearchParams({ ...filters, page: String(page) });
  const { data, error, refresh } = useData<{
      items: User[];
      pages: number;
      total: number;
    }>("students?" + params),
    loc = useData<Locations>("locations");
  const [edit, setEdit] = useState<Partial<User> | null>(null),
    [reset, setReset] = useState<User | null>(null),
    [room, setRoom] = useState({ block: "", level: "", room: "" }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  function open(student: Partial<User>) {
    setMessage("");
    setEdit(student);
    const r = loc.data?.rooms.find((r) => r.id === student.room_id);
    setRoom({
      block: r?.block_id || "",
      level: r?.level_id || "",
      room: r?.id || "",
    });
  }
  return (
    <>
      <PageTitle
        eyebrow={t("PEOPLE & ACCESS")}
        title={t("Students")}
        text={t("Manage accounts and help your residents feel at home.")}
        action={
          <button onClick={() => open({ active: 1 })}>
            <Plus size={17} />
            {t("Add student")}
          </button>
        }
      />
      <section className="panel filters">
        <div className="filter-row">
          <label>
            {t("Search students")}
            <input
              placeholder={t("Name, student ID or username")}
              value={filters.q}
              onChange={(e) => {
                setPage(1);
                setFilters({ ...filters, q: e.target.value });
              }}
            />
          </label>
          <label>
            {t("Account status")}
            <select
              value={filters.active}
              onChange={(e) => {
                setPage(1);
                setFilters({ ...filters, active: e.target.value });
              }}
            >
              <option value="">{t("All accounts")}</option>
              <option value="true">{t("Active")}</option>
              <option value="false">{t("Inactive")}</option>
            </select>
          </label>
        </div>
        {loc.data && (
          <LocationSelect
            locations={loc.data}
            value={filters}
            onChange={(v) => {
              setPage(1);
              setFilters({ ...filters, ...v });
            }}
          />
        )}
      </section>
      <ErrorBox message={error || message} />
      {!data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {data.total} {t("students")}
            </h2>
            <Users size={20} />
          </div>
          {data.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Student")}</th>
                    <th>{t("Username")}</th>
                    <th>{t("Room")}</th>
                    <th>{t("Status")}</th>
                    <th>{t("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        <small>{s.student_id}</small>
                      </td>
                      <td>{s.username}</td>
                      <td>
                        {loc.data?.rooms.find((r) => r.id === s.room_id)
                          ?.label || t("Unassigned")}
                      </td>
                      <td>
                        <span
                          className={
                            "badge " + (s.active ? "closed" : "submitted")
                          }
                        >
                          {s.active ? t("Active") : t("Inactive")}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            aria-label={t("Edit {name}", { name: s.name })}
                            onClick={() => open(s)}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={t("Reset password for {name}", {
                              name: s.name,
                            })}
                            onClick={() => {
                              setMessage("");
                              setReset(s);
                            }}
                          >
                            <KeyRound size={17} />
                          </button>
                          <Link
                            className="text-button"
                            href={"/reports?student=" + s.id}
                          >
                            {t("Reports")}
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title={t("No students found")}
              text={t("Add a student or adjust your filters.")}
            />
          )}
          <Pager page={page} pages={data.pages} onChange={setPage} />
        </section>
      )}
      {edit && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-title"
          >
            <div className="panel-heading">
              <h2 id="student-title">
                {edit.id ? t("Edit student") : t("Add student")}
              </h2>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={t("Close dialog")}
                onClick={() => setEdit(null)}
              >
                <X />
              </button>
            </div>
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setMessage("");
                try {
                  const active = f.get("active") === "true";
                  if (
                    edit.active &&
                    !active &&
                    !confirm(
                      t("Deactivate this account and end all its sessions?"),
                    )
                  )
                    return;
                  await api("students" + (edit.id ? "/" + edit.id : ""), {
                    name: f.get("name"),
                    student_id: f.get("student_id"),
                    username: f.get("username"),
                    phone: f.get("phone"),
                    email: f.get("email"),
                    room_id: room.room || null,
                    active,
                    ...(!edit.id ? { password: f.get("password") } : {}),
                  });
                  setEdit(null);
                  await refresh();
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {t("Full name")}
                <input
                  name="name"
                  defaultValue={edit.name}
                  required
                  maxLength={200}
                  autoFocus
                />
              </label>
              <div className="two-col">
                <label>
                  {t("Phone number")}
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={edit.phone || ""}
                    maxLength={40}
                  />
                </label>
                <label>
                  {t("Email")}
                  <input
                    name="email"
                    type="email"
                    defaultValue={edit.email || ""}
                    maxLength={254}
                  />
                </label>
              </div>
              <div className="two-col">
                <label>
                  {t("Student ID")}
                  <input
                    name="student_id"
                    defaultValue={edit.student_id || ""}
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  {t("Username")}
                  <input
                    name="username"
                    defaultValue={edit.username}
                    pattern="[A-Za-z0-9_.\-]{3,60}"
                    required
                    maxLength={60}
                  />
                </label>
              </div>
              {!edit.id && (
                <label>
                  {t("Initial password")}
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                  />
                  <small>
                    {t(
                      "At least 12 characters. Share it securely with the student.",
                    )}
                  </small>
                </label>
              )}
              <label>
                {t("Account status")}
                <select
                  name="active"
                  defaultValue={edit.active ? "true" : "false"}
                >
                  <option value="true">{t("Active")}</option>
                  <option value="false">{t("Inactive")}</option>
                </select>
              </label>
              <h3>
                {t("Room assignment")}
                <span className="muted">{t("optional")}</span>
              </h3>
              {loc.data && (
                <LocationSelect
                  locations={loc.data}
                  value={room}
                  onChange={setRoom}
                  activeOnly
                />
              )}{" "}
              {edit.room_id &&
                !loc.data?.rooms.find((r) => r.id === edit.room_id)
                  ?.available && (
                  <p className="muted">
                    {t(
                      "Current assignment is archived. Leave unchanged or select a new active room.",
                    )}
                  </p>
                )}
              <ErrorBox message={message} />
              <button disabled={busy}>
                {busy ? t("Saving…") : t("Save student")}
              </button>
            </form>
          </section>
        </div>
      )}
      {reset && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <div className="panel-heading">
              <h2 id="reset-title">{t("Reset password")}</h2>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={t("Close dialog")}
                onClick={() => setReset(null)}
              >
                <X />
              </button>
            </div>
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setMessage("");
                const f = new FormData(e.currentTarget);
                try {
                  await api("students/" + reset.id, {
                    action: "reset",
                    password: f.get("password"),
                  });
                  setReset(null);
                  await refresh();
                } catch (err) {
                  setMessage((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>
                {t("Set a temporary password for")}
                <strong>{reset.name}</strong>
                {t(
                  ". All sessions will end. The next-login password change follows the superadmin security setting.",
                )}
              </p>
              <label>
                {t("Temporary password")}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  autoFocus
                />
              </label>
              <ErrorBox message={message} />
              <button disabled={busy}>
                {busy ? t("Resetting…") : t("Reset password")}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
