import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import styles from "./page.module.css";

export default async function Home() {
  const { userId } = await auth();
  const ctaHref = userId ? "/dashboard" : "/sign-in";
  const ctaLabel = userId ? "進入控制台" : "免費開始";

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>八字命理</h1>
        <p className={styles.subtitle}>Bazi Platform</p>
        <p className={styles.description}>
          AI-Powered Chinese Astrology &amp; Fortune Analysis
        </p>

        <Link href={ctaHref} className={styles.ctaButton}>
          {ctaLabel}
        </Link>

        {/* Bazi Section */}
        <h2 className={styles.sectionTitle}>八字命理分析</h2>
        <div className={styles.features}>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#127963;&#65039;</span>
              <h3>八字終身運</h3>
              <p>Lifetime Destiny Analysis</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#128197;</span>
              <h3>流年運勢</h3>
              <p>Annual Fortune Forecast</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#128188;</span>
              <h3>事業財運</h3>
              <p>Career &amp; Finance</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#10084;&#65039;</span>
              <h3>愛情姻緣</h3>
              <p>Love &amp; Marriage</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#127807;</span>
              <h3>健康分析</h3>
              <p>Health Analysis</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.feature}>
              <span className={styles.featureIcon}>&#129309;</span>
              <h3>合盤比較</h3>
              <p>Compatibility</p>
            </div>
          </Link>
        </div>

        {/* ZWDS Section */}
        <h2 className={styles.sectionTitle}>紫微斗數分析</h2>
        <div className={styles.features}>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#127776;</span>
              <h3>紫微終身命盤</h3>
              <p>Lifetime Star Chart</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#128302;</span>
              <h3>紫微流年運</h3>
              <p>Annual Star Forecast</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#128188;</span>
              <h3>紫微事業運</h3>
              <p>Career Star Analysis</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#128150;</span>
              <h3>紫微愛情運</h3>
              <p>Love Star Analysis</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#127774;</span>
              <h3>紫微流月運</h3>
              <p>Monthly Star Forecast</p>
            </div>
          </Link>
          <Link href={ctaHref} className={styles.featureLink}>
            <div className={styles.featureZwds}>
              <span className={styles.featureIcon}>&#128171;</span>
              <h3>紫微每日運勢</h3>
              <p>Daily Star Fortune</p>
            </div>
          </Link>
        </div>

        <Link href={ctaHref} className={styles.ctaButton}>
          {ctaLabel}
        </Link>
      </main>
    </div>
  );
}
