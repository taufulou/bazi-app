import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { zhTW } from "@clerk/localizations";
import localFont from "next/font/local";
import { Noto_Serif_TC, Noto_Serif_SC } from "next/font/google";
import { PostHogProvider } from "./providers";
import { clerkAppearance } from "./lib/clerk-appearance";
import SignedOutRedirect from "./components/SignedOutRedirect";
import LanguageProvider from "./components/LanguageProvider";
import LanguageFirstRunModal from "./components/LanguageFirstRunModal";
import "./globals.css";
import { SITE_URL } from './lib/site-url';

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

const notoSerifTC = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-noto-serif-tc",
});

// Simplified serif — loaded for zh-CN users. `preload: false` keeps it off the
// critical path for zh-TW users; the body-scoped `[data-lang="zh-CN"]` remap in
// globals.css points `--font-noto-serif-tc` at this variable.
const notoSerifSC = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-noto-serif-sc",
  preload: false,
});

const BASE_URL = SITE_URL;

export const metadata: Metadata = {
  title: "天命 | AI 命理平台",
  description: "天命 — AI驅動的八字命理平台，提供八字排盤、終身運勢、流年運勢、八字事業詳批、愛情姻緣與日月年運勢解讀。僅供參考與娛樂用途。",
  // ZWDS removed: the feature was deleted (ad106fc), and this metadata is what
  // search results and link previews show for the site the iOS app links to.
  keywords: ["天命", "八字", "命理", "Chinese astrology", "fortune telling", "AI", "命盤"],
  metadataBase: new URL(BASE_URL),
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "天命 | AI 命理平台",
    description: "天命 — AI驅動的八字命理平台，提供八字排盤、終身運勢、流年運勢、八字事業詳批、愛情姻緣與日月年運勢解讀。僅供參考與娛樂用途。",
    url: BASE_URL,
    siteName: "天命",
    locale: "zh_TW",
    type: "website",
    images: [{ url: "/logo-1024.png", width: 1024, height: 1024, alt: "天命" }],
  },
  twitter: {
    card: "summary",
    title: "天命 | AI 命理平台",
    description: "天命 — AI驅動的八字命理平台，提供八字排盤、終身運勢、流年運勢、八字事業詳批、愛情姻緣與日月年運勢解讀。僅供參考與娛樂用途。",
    images: ["/logo-1024.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  other: {
    "theme-color": "#FFF3E0",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider localization={zhTW} appearance={clerkAppearance}>
      <html lang="zh-TW">
        <body className={`${geistSans.variable} ${geistMono.variable} ${notoSerifTC.variable} ${notoSerifSC.variable}`}>
          <PostHogProvider>
            <LanguageProvider>
              <SignedOutRedirect />
              <LanguageFirstRunModal />
              {children}
            </LanguageProvider>
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
