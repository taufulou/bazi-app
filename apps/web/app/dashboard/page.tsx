import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { READING_TYPE_META } from "@repo/shared";
import styles from "./page.module.css";
import {
  DashboardViewTracker,
  ReadingCardTracker,
  SubscriptionCtaTracker,
} from "./DashboardTracker";

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
      <DashboardViewTracker readingTypesCount={allTypes.length} />

      {/* Header */}
      <header className={styles.header}>
        <Link href="/" className={styles.logo}>
          八字命理平台
        </Link>
        <div className={styles.headerRight}>
          <SubscriptionCtaTracker location="header_link">
            <Link href="/pricing" className={styles.pricingLink}>
              💎 訂閱方案
            </Link>
          </SubscriptionCtaTracker>
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

      {/* Bazi Reading Types */}
      <section className={styles.readingsSection}>
        <h3 className={styles.sectionLabel}>八字命理分析</h3>
        <div className={styles.grid}>
          {baziTypes.map((reading, index) => (
            <ReadingCardTracker
              key={reading.slug}
              readingType={reading.slug}
              system="bazi"
              cardPosition={index}
            >
              <Link
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
            </ReadingCardTracker>
          ))}
        </div>
      </section>

      {/* ZWDS Reading Types */}
      <section className={styles.readingsSection}>
        <h3 className={styles.sectionLabel}>紫微斗數分析</h3>
        <div className={styles.grid}>
          {zwdsTypes.map((reading, index) => (
            <ReadingCardTracker
              key={reading.slug}
              readingType={reading.slug}
              system="zwds"
              cardPosition={index}
            >
              <Link
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
            </ReadingCardTracker>
          ))}
        </div>
      </section>

      {/* Subscription CTA Banner */}
      <section className={styles.ctaBanner}>
        <div className={styles.ctaContent}>
          <h3 className={styles.ctaTitle}>🔓 解鎖完整命理分析</h3>
          <p className={styles.ctaText}>
            訂閱會員即可查看所有分析的完整內容，包括詳細的性格分析、事業指引、感情建議等。
          </p>
          <SubscriptionCtaTracker location="dashboard_banner">
            <Link href="/pricing" className={styles.ctaButton}>
              查看訂閱方案
            </Link>
          </SubscriptionCtaTracker>
        </div>
      </section>
    </div>
  );
}
