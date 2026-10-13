"use client";
import { useLocale } from "./language";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  LayoutDashboard,
  FileText,
  Bell,
  Users,
  LogOut,
  Plus,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  Menu,
  X,
} from "lucide-react";
import { BRAND, type User } from "@/lib/constants";
import { api } from "@/lib/client";
import { ErrorBox, Loading } from "./shared";
import Dashboard from "./dashboard";
import { Reports, NewReport, ReportDetail } from "./reports";
import { LocationsPage, StudentsPage } from "./management";
import Notifications from "./notifications";
import Settings from "./settings";
import { LanguageSwitch } from "./language";

export default function Paini() {
  const { t, locale } = useLocale();

  const path = usePathname(),
    router = useRouter(),
    [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    api<{ user: User }>("me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [path]);
  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener("paini:expired", expired);
    return () => window.removeEventListener("paini:expired", expired);
  }, []);
  if (loading) return <Loading />;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          if (!u.must_change)
            router.push(u.role === "superadmin" ? "/settings" : "/");
        }}
      />
    );
  const links =
    user.role === "superadmin"
      ? [
          { href: "/settings", name: "Settings", icon: ShieldCheck },
          { href: "/account", name: "Account", icon: KeyRound },
        ]
      : [
          { href: "/", name: "Dashboard", icon: LayoutDashboard },
          {
            href: "/reports",
            name: user.role === "warden" ? "Reports" : "My reports",
            icon: FileText,
          },
          ...(user.role === "warden"
            ? [
                { href: "/locations", name: "Locations", icon: Building2 },
                { href: "/students", name: "Students", icon: Users },
              ]
            : [{ href: "/reports/new", name: "New report", icon: Plus }]),
          { href: "/notifications", name: "Notifications", icon: Bell },
          { href: "/account", name: "Account", icon: KeyRound },
        ];
  let content: React.ReactNode;
  if (user.must_change || path === "/account")
    content = (
      <Account
        user={user}
        onChanged={() => setUser({ ...user, must_change: 0 })}
      />
    );
  else if (user.role === "superadmin") content = <Settings />;
  else if (path === "/") content = <Dashboard user={user} />;
  else if (path === "/reports") content = <Reports user={user} />;
  else if (path === "/reports/new" && user.role === "student")
    content = <NewReport user={user} />;
  else if (path.startsWith("/reports/"))
    content = (
      <ReportDetail
        key={path.split("/")[2]}
        user={user}
        id={path.split("/")[2]}
      />
    );
  else if (path === "/locations" && user.role === "warden")
    content = <LocationsPage />;
  else if (path === "/students" && user.role === "warden")
    content = <StudentsPage />;
  else if (path === "/notifications") content = <Notifications />;
  else
    content = (
      <div className="panel">
        <h1>{t("Page not found")}</h1>
        <Link href="/">{t("Return to dashboard")}</Link>
      </div>
    );
  return (
    <div className="app">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <Link href="/" className="side-brand">
          <span className="brand-icon">
            <Building2 size={23} />
          </span>
          <span>
            {t("PAINI")}
            <small>{t("DORM MANAGEMENT")}</small>
          </span>
        </Link>
        <div className="sidebar-label">{t("WORKSPACE")}</div>
        <nav>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                (path === l.href ||
                (l.href === "/reports" &&
                  path.startsWith("/reports/") &&
                  path !== "/reports/new")
                  ? "active"
                  : "") +
                (user.must_change && l.href !== "/account" ? " locked" : "")
              }
            >
              <l.icon size={19} />
              {t(l.name)}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-note">
            <ShieldCheck size={19} />
            <span>
              {t("A better place to stay.")}
              <small>{t("One report at a time.")}</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{t(user.role)}</small>
            </span>
            <button
              className="icon-button"
              aria-label={t("Log out")}
              onClick={async () => {
                await api("logout", {});
                setUser(null);
                router.push("/");
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label={t("Toggle navigation")}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <Link href="/" className="header-brand">
            <strong>{BRAND.short}</strong>
            <span>{BRAND.expanded}</span>
          </Link>
          <LanguageSwitch />
          <span className="role-label">
            {user.role === "superadmin"
              ? "Superadmin"
              : user.role === "warden"
                ? t("Warden workspace")
                : t("Student workspace")}
          </span>
        </header>
        <main className="main">{content}</main>
        <footer>
          {BRAND.full}
          <span>{t("Made for a better dorm experience.")}</span>
        </footer>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { t, locale } = useLocale();

  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <header className="login-top">
        <Building2 />
        <strong>{BRAND.short}</strong>
        <span>{BRAND.expanded}</span>
        <LanguageSwitch />
      </header>
      <main className="login-main">
        <section className="login-story">
          <div className="eyebrow">{t("A BETTER PLACE TO STAY")}</div>
          <h1>
            {t("Your room.")}
            <br />
            {t("Your comfort.")}
            <br />
            <em>{t("Our priority.")}</em>
          </h1>
          <p>
            {t(
              "Report a problem, follow its progress, and stay connected with your wardens. A simpler way to care for your dorm.",
            )}
          </p>
          <div className="building-art" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <div className={"building building-" + n} key={n}>
                <span>{["A", "B", "C"][n - 1]}</span>
                {Array.from({ length: 12 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            ))}
          </div>
          <div className="story-bottom">
            <ShieldCheck size={18} />
            {t("Secure access. Clear updates. Shared responsibility.")}
          </div>
        </section>
        <section className="login-card">
          <span className="brand-icon">
            <Building2 size={28} />
          </span>
          <h2>{BRAND.short}</h2>
          <p className="expanded-name">{BRAND.expanded}</p>
          <div className="divider" />
          <h3>{t("Welcome back")}</h3>
          <p className="muted">
            {t("Sign in with the account provided by your warden.")}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                const d = await api<{ user: User }>("login", {
                  username: f.get("username"),
                  password: f.get("password"),
                });
                onLogin(d.user);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t("Username")}
              <input
                name="username"
                autoComplete="username"
                required
                placeholder={t("Enter your username")}
                maxLength={60}
              />
            </label>
            <label>
              {t("Password")}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder={t("Enter your password")}
                maxLength={128}
              />
            </label>
            <ErrorBox message={error} />
            <button className="wide" disabled={busy}>
              {busy ? t("Signing in…") : t("Sign in")}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="login-help">
            {t("Forgot your password? Contact your warden to reset it.")}
          </p>
        </section>
      </main>
      <footer>
        {BRAND.full}
        <span>{t("Secure dorm maintenance management")}</span>
      </footer>
    </div>
  );
}
function Account({ user, onChanged }: { user: User; onChanged: () => void }) {
  const { t, locale } = useLocale();

  const [error, setError] = useState(""),
    [success, setSuccess] = useState(false),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="narrow">
      <div className="eyebrow">{t("YOUR ACCOUNT")}</div>
      <h1>
        {user.must_change ? t("Choose a new password") : t("Account settings")}
      </h1>
      <p className="muted">
        {user.must_change
          ? t("Please replace your temporary password before continuing.")
          : t("Keep your account secure with a password only you know.")}
      </p>
      <form
        className="panel form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          setError("");
          setSuccess(false);
          if (f.get("password") !== f.get("confirm")) {
            setError("New passwords do not match.");
            return;
          }
          setBusy(true);
          try {
            await api("password", {
              current: f.get("current"),
              password: f.get("password"),
            });
            form.reset();
            onChanged();
            setSuccess(true);
            if (user.must_change)
              router.push(user.role === "superadmin" ? "/settings" : "/");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {t("Current password")}
          <input
            type="password"
            name="current"
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          {t("New password")}
          <input
            type="password"
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
          <small>{t("At least 12 characters.")}</small>
        </label>
        <label>
          {t("Confirm new password")}
          <input
            type="password"
            name="confirm"
            autoComplete="new-password"
            required
          />
        </label>
        <ErrorBox message={error} />
        {success && (
          <div className="alert success">
            {t("Password updated successfully.")}
          </div>
        )}
        <button disabled={busy}>
          {busy ? t("Saving…") : t("Change password")}
        </button>
      </form>
    </div>
  );
}
