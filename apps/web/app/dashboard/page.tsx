import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { READING_TYPE_META } from "@repo/shared";
import CreditBadge from "../components/CreditBadge";
import AccountPanel from "../components/AccountPanel";
import styles from "./page.module.css";

export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Build reading types from shared constants, separated by system
  const allTypes = (
    Object.entries(READING_TYPE_META) as [string, (typeof READING_TYPE_META)[keyof typeof READING_TYPE_META]][]
  ).map(([slug, meta]) => ({
    slug,
    icon: meta.icon,
    name: meta.nameZhTw,
    description: meta.description["zh-TW"],
  }));

  const baziTypes = allTypes.filter((t) => !t.slug.startsWith("zwds-"));
  const zwdsTypes = allTypes.filter((t) => t.slug.startsWith("zwds-"));

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          八字命理平台
        </Link>
        <div className={styles.headerRight}>
          <CreditBadge showPricingLink />
          <span className={styles.userName}>
            {user.firstName || user.emailAddresses[0]?.emailAddress || "用戶"}
          </span>
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "w-10 h-10",
              },
            }}
          />
        </div>
      </header>

      {/* Welcome Section */}
      <section className={styles.welcome}>
        <h2 className={styles.welcomeTitle}>
          歡迎回來{user.firstName ? `，${user.firstName}` : ""}
        </h2>
        <p className={styles.welcomeSubtitle}>選擇一項服務開始您的命理之旅</p>
      </section>

      {/* Quick Links */}
      <div className={styles.quickLinks}>
        <Link href="/dashboard/profiles" className={styles.profileLink}>
          <span className={styles.profileLinkIcon}>👤</span>
          <span className={styles.profileLinkText}>
            管理出生資料 — 儲存出生資料，快速開始各項分析
          </span>
          <span className={styles.profileLinkArrow}>&rarr;</span>
        </Link>
        <Link href="/dashboard/readings" className={styles.profileLink}>
          <span className={styles.profileLinkIcon}>📋</span>
          <span className={styles.profileLinkText}>
            歷史分析記錄 — 查看過去的命理分析結果
          </span>
          <span className={styles.profileLinkArrow}>&rarr;</span>
        </Link>
      </div>

      {/* Bazi Reading Types */}
      <section className={styles.readingsSection}>
        <h3 className={styles.sectionLabel}>八字命理分析</h3>
        <div className={styles.grid}>
          {baziTypes.map((reading) => (
            <Link
              key={reading.slug}
              href={`/reading/${reading.slug}`}
              className={styles.cardLink}
            >
              <div className={styles.card}>
                <div className={styles.cardIcon}>{reading.icon}</div>
                <h3 className={styles.cardTitle}>{reading.name}</h3>
                <p className={styles.cardDescription}>{reading.description}</p>
                <div className={styles.cardFooter}>
                  <span className={styles.cardAction}>開始分析 &rarr;</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ZWDS Reading Types */}
      <section className={styles.readingsSection}>
        <h3 className={styles.sectionLabel}>紫微斗數分析</h3>
        <div className={styles.grid}>
          {zwdsTypes.map((reading) => (
            <Link
              key={reading.slug}
              href={`/reading/${reading.slug}`}
              className={styles.cardLink}
            >
              <div className={styles.cardZwds}>
                <div className={styles.cardIcon}>{reading.icon}</div>
                <h3 className={styles.cardTitle}>{reading.name}</h3>
                <p className={styles.cardDescription}>{reading.description}</p>
                <div className={styles.cardFooter}>
                  <span className={styles.cardAction}>開始分析 &rarr;</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Account Panel (replaces static CTA banner) */}
      <AccountPanel />
    </div>
  );
}
