import Link from "next/link";
import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { READING_TYPE_META } from "@repo/shared";
import AppUserButton from "./components/AppUserButton";
import CreditBadge from "./components/CreditBadge";
import AccountPanel from "./components/AccountPanel";
import HeroBanner from "./components/HeroBanner";
import HomeDailyFortuneCard from "./components/HomeDailyFortuneCard";
import WelcomeFortunePill from "./components/WelcomeFortunePill";
import styles from "./page.module.css";

export default async function HomePage() {
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
    image: meta.image,
  }));

  const baziTypes = allTypes.filter(
    (t) => !t.slug.startsWith("zwds-") && t.slug !== "health"
  );
  // ZWDS types hidden for now — will re-enable in Phase B
  // const zwdsTypes = allTypes.filter((t) => t.slug.startsWith("zwds-"));

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        {/* Header */}
        <header className={styles.header}>
          <Link href="/" className={styles.logo}>
            <Image
              src="/logo-1024.png"
              alt="天命"
              width={40}
              height={40}
              className={styles.logoImage}
            />
          </Link>
          <div className={styles.headerRight}>
            <CreditBadge showPricingLink />
            <span className={styles.userName}>
              {user.firstName || user.emailAddresses[0]?.emailAddress || "用戶"}
            </span>
            <AppUserButton />
          </div>
        </header>

        {/* Welcome Row — greeting + compact daily-fortune glance + quick links */}
        <div className={styles.welcomeRow}>
          <div className={styles.welcomeLeft}>
            <h2 className={styles.welcomeTitle}>
              歡迎回來{user.firstName ? `，${user.firstName}` : ""}
            </h2>
            {/* Compact daily-fortune glance beside the greeting (full strip below the readings) */}
            <WelcomeFortunePill />
          </div>
          <div className={styles.quickLinks}>
            <Link href="/dashboard/profiles" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>👤</span>
              <span>出生資料</span>
            </Link>
            <Link href="/dashboard/readings" className={styles.quickLink}>
              <span className={styles.quickLinkIcon}>📋</span>
              <span>歷史記錄</span>
            </Link>
          </div>
        </div>

        {/* Hero Banner / Carousel — primary hero slot */}
        <HeroBanner />

        {/* Bazi Reading Types — the core product, lifted directly under the banner */}
        <section className={styles.readingsSection} id="readings">
          <h3 className={styles.sectionLabel}>八字命理分析</h3>
          <div className={styles.grid}>
            {baziTypes.map((reading) => (
              <Link
                key={reading.slug}
                href={`/reading/${reading.slug}`}
                className={styles.cardLink}
              >
                <div className={styles.card}>
                  {reading.image ? (
                    <Image
                      src={reading.image}
                      alt={reading.name}
                      width={80}
                      height={80}
                      className={styles.cardImage}
                    />
                  ) : (
                    <span className={styles.cardIcon}>{reading.icon}</span>
                  )}
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{reading.name}</h3>
                    <p className={styles.cardDescription}>{reading.description}</p>
                  </div>
                  <span className={styles.cardArrow}>&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Daily Fortune — full strip below the readings so users won't miss it.
            The 今日運勢 heading is rendered inside HomeDailyFortuneCard so it hides
            together with the card on failure — do NOT re-add an <h3> here, it
            would orphan on a downed fortune service. */}
        <section className={styles.fortuneSection}>
          <HomeDailyFortuneCard />
        </section>

        {/* ZWDS Reading Types — hidden for now, will re-enable in Phase B */}

        {/* Account Panel — compact mode hides duplicate tier/credits */}
        <AccountPanel compact />
      </div>
    </div>
  );
}
