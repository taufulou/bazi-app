/**
 * SectionDivider — small ornamental divider between major page zones.
 *
 * Per UX Refinement Sprint 2.H (locked decision 2026-05-15):
 *   - Style: «─── ◆ ───» centered ornament
 *   - 4 placements between major zones in /reading/fortune
 *   - ~40px wide ornament, gold accent, subtle horizontal lines
 *
 * Decorative only — `aria-hidden="true"`.
 */
import styles from './SectionDivider.module.css';

export default function SectionDivider() {
  return (
    <div className={styles.divider} aria-hidden="true">
      <span className={styles.line} />
      <span className={styles.diamond}>◆</span>
      <span className={styles.line} />
    </div>
  );
}
