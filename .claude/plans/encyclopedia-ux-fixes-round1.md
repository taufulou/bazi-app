# Encyclopedia UX Fixes — Round 1

## Issues to Fix

### Fix 1: 辛 透干 Bug — Same-Pillar Skip Logic (R3)
**Bug**: `_detect_tougan()` skips the same pillar entirely. When 辛 is hidden in year branch AND year stem is also 辛, it falsely reports "辛藏而不透".
**Fix**: Conditional skip:
```python
if pkey == pillar and pdata.get('stem') != value:
    continue
```
**Same-pillar description variant**: When the match is in the same pillar, use different wording:
```python
if pkey == pillar:
    description = f'此藏干{value}與本柱天干相同，直接透出——藏干的力量...'
else:
    description = f'此藏干{value}已透出{plabel}天干，力量大增——...'
```
**Test updates**:
- Rename `test_tougan_same_pillar_skipped` → `test_tougan_same_pillar_stem_matches` (asserts 透干 found)
- Add `test_tougan_same_pillar_different_stem` (asserts still skipped)
**File**: `cross_pillar.py`, `test_cross_pillar.py`

### Fix 2: Personalized Text Size Too Small
**Fix**: Change `.sectionText` and `.interactionDesc` from `0.85rem` → `0.9rem`.
**File**: `ElementExplanation.module.css`

### Fix 3: 藏干 Layer B — Remove Conditional 透干 Sentences (R2)
**Regex**: `r'若此藏干透出天干（即其他柱的天干中也出現.{1,2}[木火土金水]?），[^。]+。'`
Run once, commit result. Add regression test: no Layer B contains "若此藏干透出天干".
**File**: `hidden_stems.json`, `test_explanations.py`

### Fix 4: Remove 旺衰取用法 Disclaimer (R2)
**Strings to remove** (glob `data/explanations/*.json`):
1. `本分析基於旺衰取用法。不同命理流派對喜用神的判定可能有所差異。`
2. `若此十神的天干與其他天干相合，其實際效果可能因合化而改變。`
Run once, commit. Add regression test.
**Files**: All `data/explanations/*.json`

### Fix 5: Free Tier — Don't Show Interactions
Move interactions section inside `{isSubscriber ? ... : ...}` block. UI-only gate per project architecture.
**File**: `ElementExplanation.tsx`

### Fix 6: Bottom Sheet — Swipe Up to Expand (R3 — fully revised)

**Architecture**: Two-div structure with clip container + inner scroll.

```
.sheet (outer: position fixed, bottom:0, height: 85vh)
  ├── transform: translateY(35vh) [collapsed] / translateY(0) [expanded]
  ├── overflow: hidden (CLIP — prevents content leaking below viewport)
  │
  └── .dragHandle (touch events ONLY here)
  └── .sheetContent (inner scrollable area)
        ├── overflow-y: auto
        ├── max-height: calc(50vh - dragHandle - header) [collapsed]
        ├── max-height: calc(85vh - dragHandle - header) [expanded]
        └── transition: max-height 0.3s ease-out (on inner only)
```

**Why this solves the scroll-behind-viewport issue**: The outer `.sheet` has `overflow: hidden` which clips content. The inner `.sheetContent` has a dynamic `max-height` that matches the VISIBLE area, so scrolling never reaches content below the viewport edge.

**Performance note**: We're animating `max-height` on the INNER div, not the outer. However since the outer uses `transform` for the slide, the main animation is still compositor-friendly. The inner `max-height` change only affects the scroll container size, not the animation itself.

**Entry animation**: Change `@keyframes slideUp` to end at `translateY(35vh)` (collapsed state) instead of `translateY(0)`:
```css
@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(35vh); }
}
```
When expanded, the entry animation finishes at collapsed, then the expand transition takes over.

**Touch handling**:
- Touch events (`onTouchStart/Move/End`) attached ONLY to `.dragHandle` div
- Sheet content area scrolls normally via native CSS `overflow-y: auto`
- **Deliberate UX trade-off**: Users can no longer swipe-down-to-close on the content area. They must use the drag handle or tap the backdrop. This is intentional — it prevents the swipe-vs-scroll conflict that affected paid users with long content.

**Swipe thresholds** (drag handle only):
- UP > 40px → expand
- DOWN > 60px when expanded → collapse
- DOWN > 60px when collapsed → close

**State**:
```tsx
const [expanded, setExpanded] = useState(false);
useEffect(() => setExpanded(false), [elementType, value, pillar]);
```

**Files**: `ElementExplanation.tsx`, `ElementExplanation.module.css`

## Implementation Order

1. Fix 1 (辛 bug) — Python backend + tests
2. Fix 3 (Layer B cleanup) — JSON + regression test
3. Fix 4 (disclaimer removal) — JSON + regression test
4. Fix 2 (text size) — CSS
5. Fix 5 (free tier gate) — React
6. Fix 6 (expandable sheet) — React + CSS
7. Run full test suite

## Files Modified

| File | Fixes |
|------|-------|
| `cross_pillar.py` | Fix 1 |
| `test_cross_pillar.py` | Fix 1 |
| `hidden_stems.json` | Fix 3 |
| All `data/explanations/*.json` | Fix 4 |
| `test_explanations.py` | Fix 3, 4 |
| `ElementExplanation.module.css` | Fix 2, 6 |
| `ElementExplanation.tsx` | Fix 5, 6 |
