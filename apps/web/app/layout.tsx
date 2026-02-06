import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { zhTW } from "@clerk/localizations";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "八字命理平台 | Bazi Platform",
  description: "AI-powered Chinese astrology and Bazi (八字) fortune analysis platform",
  keywords: ["八字", "命理", "Bazi", "Chinese astrology", "fortune telling", "AI"],
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
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
