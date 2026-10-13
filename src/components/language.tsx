"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { translate, type Locale } from "@/lib/translations";
const Context = createContext({
  locale: "ms" as Locale,
  setLocale: (_value: Locale) => {},
  t: (key: string, params: Record<string, string | number> = {}) =>
    translate(key, "ms", params),
});
export function LanguageProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `paini_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);
  useEffect(() => {
    const clear = (event: Event) => {
      const input = event.target;
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement ||
        input instanceof HTMLSelectElement
      )
        input.setCustomValidity("");
    };
    const invalid = (event: Event) => {
      const input = event.target;
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement ||
        input instanceof HTMLSelectElement
      )
        input.setCustomValidity(translate("validation_failed", locale));
    };
    document
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input,textarea,select")
      .forEach((e) => e.setCustomValidity(""));
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
    };
  }, [locale]);
  return (
    <Context.Provider
      value={{
        locale,
        setLocale,
        t: (key, params = {}) => translate(key, locale, params),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useLocale = () => useContext(Context);
export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      className="language-switch"
      role="group"
      aria-label="Bahasa / Language"
    >
      <button
        type="button"
        aria-pressed={locale === "ms"}
        onClick={() => setLocale("ms")}
      >
        Bahasa Melayu
      </button>
      <button
        type="button"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        English
      </button>
    </div>
  );
}
