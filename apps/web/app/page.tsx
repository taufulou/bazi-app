import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>八字命理</h1>
        <p className={styles.subtitle}>Bazi Platform</p>
        <p className={styles.description}>
          AI-Powered Chinese Astrology &amp; Fortune Analysis
        </p>
        <div className={styles.features}>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#127963;&#65039;</span>
            <h3>八字終身運</h3>
            <p>Lifetime Destiny Analysis</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#128197;</span>
            <h3>流年運勢</h3>
            <p>Annual Fortune Forecast</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#128188;</span>
            <h3>事業財運</h3>
            <p>Career &amp; Finance</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#10084;&#65039;</span>
            <h3>愛情姻緣</h3>
            <p>Love &amp; Marriage</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#127807;</span>
            <h3>健康分析</h3>
            <p>Health Analysis</p>
          </div>
          <div className={styles.feature}>
            <span className={styles.featureIcon}>&#129309;</span>
            <h3>合盤比較</h3>
            <p>Compatibility</p>
          </div>
        </div>
      </main>
    </div>
  );
}
