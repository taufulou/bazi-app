# V7-G: Score Animation + 老師寄語 + Badges Merge Plan (Rev 2)

## Context
User wants: score animation + 老師寄語 + StarCountBadges as ONE combined section, shown ONLY after paywall unlock, BEFORE AI sections stream.

## Staff Engineer Review — Rev 2 Fixes
1. **Score ring track**: Use `rgba(212, 160, 23, 0.25)` for bg track (visible on warm-cream theme, NOT V1's 10% opacity)
2. **Reassurance banner**: Moves to post-paywall only (inside combined component). Pre-paywall users see score circle + label only. This is intentional — low-score messaging is part of the consultation experience.
3. **StarCountBadges in free section**: REMOVE from chart panel. Badges move to post-paywall combined component only. Remove both the component function and CSS from page.tsx/page.module.css.
4. **Optional chains**: All `romancePA?.` paths from MasterNote must be exactly replicated.

## Current State
- `CompatibilityScoreReveal.tsx` exists (used for V1 business/friendship only)
- `MasterNote` component in `page.tsx` (deterministic narrative)
- `StarCountBadges` component in `page.tsx` (peach blossom + spouse star counts)
- Score reveal is currently SKIPPED for V2 romance (`!isCurrentRomance` guard)
- MasterNote currently renders inside `v2SectionsContainer` (after paywall unlock)

## Design

### Combined Section (post-paywall, pre-AI-sections)
```
┌─────────────────────────────────────┐
│         [Score Ring: 59]            │  ← animated count-up (2s)
│         需要經營                      │  ← label (fade in at 2.5s)
│   配對基礎36分 × 60%                │  ← breakdown (fade in at 3s)
│   + 婚後品質97分 × 40%              │
│                                     │
│  ── Roger36 ──────────────────────  │
│  🌸 桃花1朵  💍 姻緣星2顆          │  ← fade in at 3.5s
│  ── Laopo16 ──────────────────────  │
│  🌸 桃花0朵  💍 姻緣星1顆          │
├─────────────────────────────────────┤
│  📋 老師寄語                         │  ← fade in at 4s
│  從Roger36和Laopo16的八字命盤...     │  WHITE bg card
│  綜合配對指數為59分...               │
│  以下為詳細的逐項分析...             │
└─────────────────────────────────────┘
```

### Flow
1. User clicks "解鎖報告" (paywall button)
2. Credits deducted, `isUnlocking` = true
3. Paywall disappears
4. **Score animation plays** (inside `v2SectionsContainer`, ABOVE loading skeletons)
5. While animation plays, AI generation starts in background
6. After animation ends (~5s), AI sections start streaming below
7. Score + 老師寄語 persist at top (static) while AI sections stream

## Files to Change

### 1. `apps/web/app/reading/compatibility/page.tsx`

**A. Remove standalone components:**
- Remove `MasterNote` function definition (lines ~111-160)
- Remove `StarCountBadges` function definition (lines ~165-180)
- Remove `StarCountBadges` usage from chart panel section (inside `freeChartsSection`)
- Remove `MasterNote` usage from `v2SectionsContainer`
- Remove reassurance banner (it moves into the combined component)

**B. Add combined score reveal in v2SectionsContainer:**
Replace the removed `MasterNote` with:
```tsx
{/* V7-G: Combined score reveal + badges + 老師寄語 (post-paywall) */}
<CompatibilityScoreRevealV2
  score={displayScore}
  label={displayLabel}
  scoreBreakdown={romancePA?.scoreBreakdown}
  nameA={nameA}
  nameB={nameB}
  peachBlossomCountA={romancePA?.peachBlossomCountA ?? 0}
  peachBlossomCountB={romancePA?.peachBlossomCountB ?? 0}
  spouseStarCountA={romancePA?.spouseStarCountA ?? 0}
  spouseStarCountB={romancePA?.spouseStarCountB ?? 0}
  romancePA={romancePA}
/>
```

Place this at the TOP of `v2SectionsContainer`, before the unknown-hour banner and AI sections.

**C. No step="reveal" change needed.** V2 romance still skips the V1 reveal step. The combined component renders as a static-then-animated section inside the result view, not as a separate step.

### 2. NEW: `apps/web/app/components/CompatibilityScoreRevealV2.tsx`

Create a NEW component (don't modify V1's `CompatibilityScoreReveal.tsx`).

**Props:**
```typescript
interface CompatibilityScoreRevealV2Props {
  score: number;
  label: string;
  scoreBreakdown?: {
    baseScore: number;
    sweetnessScore: number;
    stabilityScore: number;
    romanceAvg: number;
    formula: string;
  };
  nameA: string;
  nameB: string;
  peachBlossomCountA: number;
  peachBlossomCountB: number;
  spouseStarCountA: number;
  spouseStarCountB: number;
  romancePA: any;  // for 老師寄語 narrative
}
```

**Animation phases (useEffect + useState):**
- Phase 0 (0ms): Mount, start count-up animation
- Phase 1 (2000ms): Score ring fully filled, number settled
- Phase 2 (2500ms): Label fades in
- Phase 3 (3000ms): Score breakdown fades in
- Phase 4 (3500ms): StarCountBadges fade in (both persons)
- Phase 5 (4000ms): Reassurance banner (if score < 55) fades in
- Phase 6 (4500ms): 老師寄語 card fades in

**Score ring**: Reuse the SVG ring pattern from V1's `CompatibilityScoreReveal.tsx`:
- Same `getScoreColor()` function
- Same `easeOutCubic` count-up
- Same ring dimensions (200px desktop, 160px mobile)
- Same color thresholds

**Score breakdown** (new, below label):
```tsx
<div className={styles.scoreBreakdown}>
  配對基礎 {breakdown.baseScore}分 × 60% + 婚後品質 {breakdown.romanceAvg}分 × 40%
</div>
```

**StarCountBadges** (inline, per person):
```tsx
<div className={styles.badgesRow}>
  <div className={styles.personBadges}>
    <span className={styles.personName}>{nameA}</span>
    <span className={styles.badge} data-type="peach">🌸 桃花 {peachBlossomCountA}朵</span>
    <span className={styles.badge} data-type="spouse">💍 姻緣星 {spouseStarCountA}顆</span>
  </div>
  <div className={styles.personBadges}>
    <span className={styles.personName}>{nameB}</span>
    <span className={styles.badge} data-type="peach">🌸 桃花 {peachBlossomCountB}朵</span>
    <span className={styles.badge} data-type="spouse">💍 姻緣星 {spouseStarCountB}顆</span>
  </div>
</div>
```

**Reassurance banner** (conditional, score < 55):
Same content as current, but inside this component.

**老師寄語** (deterministic narrative):
Same logic as current `MasterNote`, but rendered inside this component with WHITE bg card.

### 3. NEW: `apps/web/app/components/CompatibilityScoreRevealV2.module.css`

**Key styles:**

```css
.container {
  text-align: center;
  padding: 2rem 1rem;
  max-width: 600px;
  margin: 0 auto 1.5rem;
}

/* Score ring — same dimensions as V1 */
.scoreRing {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 0 auto 1rem;
}

/* Score number — same as V1 */
.scoreNumber {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -55%);
  font-size: clamp(3rem, 8vw, 4.5rem);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.scoreUnit {
  font-size: 1rem;
  font-weight: 400;
  color: var(--text-secondary, #6B5940);
}

/* Label */
.label {
  font-family: 'Noto Serif TC', serif;
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--text-accent, #C41E3A);
  margin-bottom: 0.5rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
.label.visible { opacity: 1; transform: translateY(0); }

/* Score breakdown */
.scoreBreakdown {
  font-size: 0.85rem;
  color: var(--text-muted, #8B7355);
  margin-bottom: 1.5rem;
  opacity: 0;
  transition: opacity 0.5s ease-out;
}
.scoreBreakdown.visible { opacity: 1; }

/* Badges row */
.badgesRow {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
.badgesRow.visible { opacity: 1; transform: translateY(0); }

.personBadges {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.personName {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary, #6B5940);
  min-width: 60px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.65rem;
  border-radius: 20px;
  font-size: 0.8rem;
  font-weight: 600;
}
.badge[data-type="peach"] {
  background: rgba(233, 30, 99, 0.08);
  color: #C2185B;
  border: 1px solid rgba(233, 30, 99, 0.15);
}
.badge[data-type="spouse"] {
  background: rgba(184, 134, 11, 0.08);
  color: #B8860B;
  border: 1px solid rgba(184, 134, 11, 0.15);
}

/* Reassurance banner */
.reassurance {
  display: flex;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
  margin: 0 auto 1.5rem;
  max-width: 500px;
  background: linear-gradient(135deg, #f0faf0 0%, #e8f5e8 100%);
  border: 1px solid rgba(46, 125, 50, 0.15);
  border-radius: 10px;
  text-align: left;
  opacity: 0;
  transition: opacity 0.5s ease-out;
}
.reassurance.visible { opacity: 1; }

/* 老師寄語 — WHITE bg card */
.masterNote {
  background: #FFFFFF;
  border: 1px solid var(--border-light, rgba(212,160,23,0.15));
  border-radius: 12px;
  padding: 1.2rem 1.5rem;
  margin: 0 auto;
  max-width: 600px;
  text-align: left;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.5s ease-out, transform 0.5s ease-out;
}
.masterNote.visible { opacity: 1; transform: translateY(0); }

/* ... masterNoteHeader, masterNoteTitle, masterNoteText same as current */
```

### 4. Remove annual_love sub-headers

In `apps/web/app/components/AIReadingDisplay.tsx`, find the `CompatSectionBadge` function. For `annual_love_a` and `annual_love_b` cases, return `null` instead of a verdict banner.

## Files Summary

| File | Action |
|------|--------|
| `CompatibilityScoreRevealV2.tsx` | **CREATE** — new combined component |
| `CompatibilityScoreRevealV2.module.css` | **CREATE** — new styles |
| `page.tsx` | **EDIT** — remove MasterNote/StarCountBadges, add V2 reveal |
| `page.module.css` | **EDIT** — remove unused masterNote/starCount/reassurance styles |
| `AIReadingDisplay.tsx` | **EDIT** — return null for annual_love badges |

## NOT Changed
- `CompatibilityScoreReveal.tsx` — V1 component untouched
- Python engine — no changes
- NestJS — no changes
- Prompts — no changes
