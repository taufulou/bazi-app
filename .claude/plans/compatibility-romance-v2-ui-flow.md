# 感情合盤 V2 — UI Flow Redesign Plan

## Design Direction

**Before paywall (FREE)**: Both BaziCharts side-by-side → paywall CTA. No score, no radar, no score reveal animation.
**After unlock (PAID)**: Both charts (still visible) → score card + radar chart + dimensions → 17 AI sections → educational → summary.

This matches the 八字愛情姻緣 pattern: show deterministic chart for free, everything else behind paywall.

---

## Current Flow (to be changed)

```
Form → Score Reveal Animation → Score+Radar+Dimensions (FREE) → Paywall → AI Sections (PAID)
```

## New Flow

```
Form → Both BaziCharts side-by-side (FREE) → Paywall → Score+Radar+Dimensions + AI Sections (PAID)
```

---

## Changes Required

### 1. Remove score reveal from V2 romance flow

**File**: `page.tsx`

Currently at line ~440, after form submission for romance:
```typescript
setStep("reveal");  // triggers CompatibilityScoreReveal
```

**Change**: Skip "reveal" step entirely for V2 romance. Go directly from form to "result":
```typescript
setStep("result");  // skip reveal, go straight to charts + paywall
```

Also remove or guard the reveal rendering (line ~667-674):
```tsx
{/* Score reveal — only for non-V2 (business/friendship) */}
{step === "reveal" && compatData && !isCurrentRomance && (
  <CompatibilityScoreReveal ... />
)}
```

### 2. Replace free section: CompatibilityResultPage → dual BaziCharts

**File**: `page.tsx`

Currently at lines ~680-690, the free section renders `CompatibilityResultPage` (score + radar + dimensions):
```tsx
<div className={styles.freeScoreSection}>
  <CompatibilityResultPage data={compatData} aiData={null} ... />
</div>
```

**Replace with** two `BaziChart` components side-by-side:

```tsx
<div className={styles.freeChartsSection}>
  {/* Page header */}
  <div className={styles.compatHeader}>
    <h1 className={styles.compatTitle}>◆ 八字感情合盤 ◆</h1>
    <p className={styles.compatSubtitle}>
      {nameA || '男方'} × {nameB || '女方'}
    </p>
  </div>

  {/* Dual BaziCharts — side by side */}
  <div className={styles.dualChartsGrid}>
    <div className={styles.chartPanel}>
      <div className={styles.chartPanelLabel}>男方</div>
      <BaziChart
        data={chartDataA}
        name={nameA}
        birthDate={compatData?.profileA?.birthDate}
        visibleSections={4}  /* Show pillars + DM + five elements + extra pillars; hide luck periods + shensha */
      />
    </div>
    <div className={styles.chartPanel}>
      <div className={styles.chartPanelLabel}>女方</div>
      <BaziChart
        data={chartDataB}
        name={nameB}
        birthDate={compatData?.profileB?.birthDate}
        visibleSections={4}  /* Same: clean preview without crowding at 450px */
      />
    </div>
  </div>
</div>
```

**Data extraction**: `chartDataA` and `chartDataB` come from `compatData.calculationData.chartA` and `chartB`. The BaziChart component expects a specific shape — verify compatibility with the chart output from `calculate_bazi()`. The compatibility endpoint returns `chartA` and `chartB` which are full `calculate_bazi()` outputs, so they should be compatible with `BaziChartData`.

### 3. Move score + radar to AFTER paywall unlock

**File**: `page.tsx`

After the paywall is unlocked, the post-unlock section should show:
1. Score card + radar (from `CompatibilityResultPage`)
2. AI sections (streamed)

```tsx
{/* After unlock: Score + Radar + Dimensions */}
{!showPaywall && compatData && (
  <div className={styles.unlockedScoreSection}>
    <CompatibilityResultPage
      data={compatData}
      aiData={null}  /* radar only, no AI sections here */
      isSubscriber={userTier !== "FREE"}
      onNewComparison={handleTryAgain}
      onRecalculate={handleRecalculate}
      isRecalculating={isRecalculating}
      isAILoading={isStreaming}
    />
  </div>
)}

{/* Streaming AI sections follow below */}
```

### 4. CSS for side-by-side charts

**File**: `page.module.css`

```css
.freeChartsSection {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.compatHeader {
  text-align: center;
  margin-bottom: 24px;
}

.compatTitle {
  font-family: 'Noto Serif TC', serif;
  font-size: 1.5rem;
  background: linear-gradient(135deg, var(--color-red), var(--color-orange));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0 0 8px;
}

.compatSubtitle {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.dualChartsGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 24px;
}

.chartPanel {
  background: var(--bg-card, #fff);
  border-radius: 16px;
  border: 1px solid var(--border-light, rgba(212,160,23,0.15));
  box-shadow: var(--shadow-warm, 0 4px 20px rgba(226,61,40,0.08));
  overflow-x: auto;  /* safety for luck periods table overflow at narrow widths */
}

.chartPanelLabel {
  text-align: center;
  padding: 10px 0 4px;
  font-family: 'Noto Serif TC', serif;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-accent, #C41E3A);
  letter-spacing: 0.1em;
}

/* Tablet + mobile: stack vertically (900px breakpoint for comfortable chart width) */
@media (max-width: 900px) {
  .dualChartsGrid {
    grid-template-columns: 1fr;
  }
}

.unlockedScoreSection {
  max-width: 900px;
  margin: 0 auto 24px;
}
```

### 5. Import BaziChart

**File**: `page.tsx`

Add import at the top:
```tsx
import BaziChart from "../../components/BaziChart";
```

### 6. Extract chart data for BaziChart

The `compatData.calculationData` contains `chartA` and `chartB` which are full `calculate_bazi()` outputs. The `BaziChart` component expects `BaziChartData` which includes `fourPillars`, `dayMaster`, `lunarDate`, etc.

Need to verify the key mapping. The Python engine output uses camelCase (`fourPillars`, `dayMaster`, `lunarDate`) which matches BaziChart's expected format since the same engine is used for individual readings.

```tsx
const calcData = compatData?.calculationData as any;
const chartDataA = calcData?.chartA;
const chartDataB = calcData?.chartB;
const nameA = compatData?.profileA?.name || '男方';
const nameB = compatData?.profileB?.name || '女方';
```

### 7. Guard the handleRevealComplete

Currently `handleRevealComplete` transitions from "reveal" to "result". Since we're skipping "reveal" for V2 romance, this function may still be referenced. Make it a no-op for romance V2 or remove it from the reveal guard.

### 8. Update form submission flow

In the form submission handler, for romance:
- Currently: calls API → sets step to "reveal"
- New: calls API → sets step to "result" + **`setShowPaywall(true)`** directly

**CRITICAL**: `setShowPaywall(true)` must be set here because the current code sets it inside `handleRevealComplete` (which we're skipping for V2 romance). Without it, the paywall never appears.

```tsx
if (isRomance) {
  const result = await createBaziCompatibility(token, { ...params, skipAI: true });
  currentComparisonIdRef.current = result.id;
  savedSubmitParamsRef.current = params;
  setCompatData(result);
  setStep("result");
  setShowPaywall(true);  // MUST set here since we skip reveal
}
```

The "analyzing" overlay (排盤計算中...) still shows during the API call — this is fine and expected.

---

## Full Page Layout (New Flow)

### Before Unlock:
```
┌──────────────────────────────────────┐
│  ◆ 八字感情合盤 ◆                     │  (gradient header)
│  男方名 × 女方名                       │
├─────────────────┬────────────────────┤
│  [男方]          │  [女方]             │
│  BaziChart       │  BaziChart         │  (FREE)
│  四柱排盤        │  四柱排盤           │
│  五行圓環        │  五行圓環           │
│  日主/格局       │  日主/格局          │
├─────────────────┴────────────────────┤
│  💑 八字感情合盤完整報告               │  (PAYWALL CTA)
│  包含：合盤分數、八維度分析、           │
│  戀愛性格、旺夫旺妻...                 │
│  [解鎖完整報告 💎 3點]                 │
└──────────────────────────────────────┘
```

### After Unlock:
```
┌──────────────────────────────────────┐
│  ◆ 八字感情合盤 ◆                     │
│  男方名 × 女方名                       │
├─────────────────┬────────────────────┤
│  [男方 BaziChart] │ [女方 BaziChart]   │  (still visible)
├─────────────────┴────────────────────┤
│  [Score: 36分 · 挑戰重重]              │
│  [8-Dimension Radar Chart]            │  (NOW VISIBLE)
│  [Dimension bars + findings]          │
├──────────────────────────────────────┤
│  AI Section 1: 男方命局特點            │
│  AI Section 2: 女方命局特點            │  (streamed)
│  ...                                  │
│  AI Section 17: 感情綜合總結           │
├──────────────────────────────────────┤
│  「本服務僅供參考與娛樂用途」           │
└──────────────────────────────────────┘
```

---

## Updated Paywall CTA Content

The paywall CTA should mention the score as a teaser since it's now hidden:

**Current features list**: 雙方命局特點, 戀愛性格分析, 旺夫/旺妻分析, 婚前婚後財富, 婚後甜蜜度&穩定度, 婚變危機預測, 經營婚姻建議, 本年感情運勢

**Updated features list** (add score + radar as first item):
- 合盤分數 & 八維度雷達分析
- 雙方命局特點
- 戀愛性格分析
- 旺夫/旺妻分析
- 婚前婚後財富
- 婚後甜蜜度 & 穩定度
- 婚變危機預測
- 本年感情運勢

---

## Implementation Checklist

| # | Change | File | Est. Lines |
|---|--------|------|-----------|
| 1 | Skip score reveal for V2 romance | page.tsx | ~5 |
| 2 | Replace CompatibilityResultPage with dual BaziCharts in free section | page.tsx | ~30 |
| 3 | Move CompatibilityResultPage to after-paywall section | page.tsx | ~10 |
| 4 | Add CSS for side-by-side charts + responsive | page.module.css | ~50 |
| 5 | Import BaziChart | page.tsx | 1 |
| 6 | Extract chartA/chartB from calcData | page.tsx | ~5 |
| 7 | Guard handleRevealComplete for V2 | page.tsx | ~3 |
| 8 | Update form submission to skip reveal | page.tsx | ~3 |
| 9 | Update paywall CTA features list | CompatibilityRomancePaywallCTA.tsx | ~3 |

**Total**: ~110 lines changed/added.

## Non-Changes

- `CompatibilityResultPage` component: NOT modified (still used after unlock for score+radar+dimensions)
- `CompatibilityScoreReveal` component: NOT modified (still used for business/friendship)
- `BaziChart` component: NOT modified (reused as-is)
- Backend: NO changes
- Business/friendship flow: UNCHANGED
