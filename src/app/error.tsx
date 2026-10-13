"use client";
import { useLocale } from "@/components/language";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLocale();
  return (
    <main className="standalone">
      <h1>{t("Something went wrong")}</h1>
      <p>
        {t("Your saved reports are safe. Please try loading this page again.")}
      </p>
      <button onClick={reset}>{t("Try again")}</button>
    </main>
  );
}
