import type { Metadata } from "next";
import { BRAND } from "@/lib/constants";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./globals.css";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/language";
export const metadata: Metadata = {
  title: { default: "PAINI | Dorm management", template: "%s | PAINI" },
  description: BRAND.full,
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale =
    (await cookies()).get("paini_locale")?.value === "en" ? "en" : "ms";
  return (
    <html lang={locale}>
      <body>
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
