import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { zhTW } from "@clerk/localizations";
import localFont from "next/font/local";
import { Noto_Serif_TC } from "next/font/google";
import { PostHogProvider } from "./providers";
import "./globals.css";

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

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bazi-platform.com';

export const metadata: Metadata = {
  title: "天命 | AI 命理平台",
  description: "天命 — AI驅動的命理分析平台，提供八字、紫微斗數、終身運勢、流年運勢、八字事業詳批、愛情姻緣等專業解讀。",
  keywords: ["天命", "八字", "命理", "紫微斗數", "Chinese astrology", "fortune telling", "AI", "命盤"],
  metadataBase: new URL(BASE_URL),
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "天命 | AI 命理平台",
    description: "天命 — AI驅動的命理分析平台，提供八字、紫微斗數、終身運勢、流年運勢、八字事業詳批、愛情姻緣等專業解讀。",
    url: BASE_URL,
    siteName: "天命",
    locale: "zh_TW",
    type: "website",
    images: [{ url: "/logo-1024.png", width: 1024, height: 1024, alt: "天命" }],
  },
  twitter: {
    card: "summary",
    title: "天命 | AI 命理平台",
    description: "天命 — AI驅動的命理分析平台，提供八字、紫微斗數、終身運勢、流年運勢、八字事業詳批、愛情姻緣等專業解讀。",
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
    <ClerkProvider
      localization={zhTW}
      appearance={{
        variables: {
          colorPrimary: "#E23D28",
          colorBackground: "#FFFBF5",
          colorText: "#3C2415",
          colorInputBackground: "#FFFFFF",
          colorInputText: "#3C2415",
        },
      }}
    >
      <html lang="zh-TW">
        <body className={`${geistSans.variable} ${geistMono.variable} ${notoSerifTC.variable}`}>
          <PostHogProvider>{children}</PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
