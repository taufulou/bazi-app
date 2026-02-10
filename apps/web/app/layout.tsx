import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { zhTW } from "@clerk/localizations";
import localFont from "next/font/local";
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

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bazi-platform.com';

export const metadata: Metadata = {
  title: "八字命理平台 | Bazi Platform",
  description: "AI驅動的八字命理分析平台，提供終身運勢、流年運勢、事業財運、愛情姻緣等專業解讀。",
  keywords: ["八字", "命理", "Bazi", "Chinese astrology", "fortune telling", "AI", "紫微斗數", "命盤"],
  metadataBase: new URL(BASE_URL),
  openGraph: {
    title: "八字命理平台 | AI-Powered Bazi Analysis",
    description: "AI驅動的八字命理分析平台，提供終身運勢、流年運勢、事業財運、愛情姻緣等專業解讀。",
    url: BASE_URL,
    siteName: "八字命理平台",
    locale: "zh_TW",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "八字命理平台 | AI-Powered Bazi Analysis",
    description: "AI驅動的八字命理分析平台，提供終身運勢、流年運勢、事業財運、愛情姻緣等專業解讀。",
  },
  robots: {
    index: true,
    follow: true,
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
          colorPrimary: "#e8d5b7",
          colorBackground: "#1a1a2e",
          colorText: "#e0e0e0",
          colorInputBackground: "#16213e",
          colorInputText: "#e0e0e0",
        },
        elements: {
          formButtonPrimary:
            "bg-[#e8d5b7] text-[#1a1a2e] hover:bg-[#d4c4a8]",
          card: "bg-[#16213e] border-[#e8d5b7]/20",
          headerTitle: "text-[#e8d5b7]",
          headerSubtitle: "text-[#a0a0a0]",
          socialButtonsBlockButton:
            "border-[#e8d5b7]/30 text-[#e0e0e0] hover:bg-[#1a1a2e]",
          formFieldLabel: "text-[#a0a0a0]",
          footerActionLink: "text-[#e8d5b7] hover:text-[#d4c4a8]",
        },
      }}
    >
      <html lang="zh-TW">
        <body className={`${geistSans.variable} ${geistMono.variable}`}>
          <PostHogProvider>{children}</PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
