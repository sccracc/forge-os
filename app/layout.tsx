import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { fontSans, fontMono } from "@/lib/fonts";
import { THEME_COOKIE, THEME_INIT_SCRIPT, resolvePref } from "@/lib/theme";
import { Providers } from "@/components/providers";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "Forge OS",
  description:
    "Forge OS — an integrated AI workspace. Chat, build, and ship in one place.",
  applicationName: "Forge OS",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const pref = resolvePref(cookieStore.get(THEME_COOKIE)?.value);
  // "system" resolves on the client (script below); default the SSR attribute to light.
  const ssrTheme = pref === "dark" ? "dark" : "light";

  return (
    <html
      lang="en"
      data-theme={ssrTheme}
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="molten-atmosphere" suppressHydrationWarning>
        <Providers initialThemePref={pref}>{children}</Providers>
      </body>
    </html>
  );
}
