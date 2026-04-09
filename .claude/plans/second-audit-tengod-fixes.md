# Day Pillar Combos — Second Audit Ten God Fixes

## Context
Second Bazi master audit found 11 ten god classification errors in `day_pillar_combos.json`. Root cause: incorrect 正/偏 determination (same yin/yang = 偏, different = 正). All fixes verified by computational cross-check against `HIDDEN_STEMS` constant and polarity rules.

The 九醜日 issue for 丁酉 was researched and confirmed INCORRECT — 丁酉 IS a standard 九醜日. No change needed.

## File to Modify
`packages/bazi-engine/data/explanations/day_pillar_combos.json` — 11 fixes only

## Fixes (all verified by computation)

### HIGH — gradeReason AND summary both wrong (3)

**丁卯**: 乙→丁 both yin = **偏印** (not 正印)
- gradeReason: `"坐正印但處病地"` → `"坐偏印但處病地"`
- summary: `"乙木正印"` → `"乙木偏印"` (find-replace in summary text)

**戊寅**: 甲→戊 both yang = **偏官** (not 正官)
- gradeReason: `"坐長生帶正官"` → `"坐長生帶偏官"`
- summary: `"甲木正官"` → `"甲木偏官"` (find-replace in summary text)

**丁酉**: 辛→丁 both yin = **偏財** (not 正財)
- gradeReason: `"坐長生帶正財"` → `"坐長生帶偏財"`
- summary: `"辛金正財"` → `"辛金偏財"`, `"正財運"` → `"偏財運"` (find-replace)

### MEDIUM — gradeReason only (8)

| Combo | Current gradeReason text | Fix (replace only the wrong ten god) |
|-------|------------------------|------|
| 壬午 | "帶偏官" | → "帶正官" (己→壬 diff polarity = 正官) |
| 己亥 | "帶偏官" | → "帶正官" (甲→己 diff polarity = 正官) |
| 甲辰 | "帶正官" | → "帶劫財" (辰 has 戊偏財/乙劫財/癸正印, no 正官) |
| 丁未 | "帶偏財" | → "帶偏印" (未 has 己食神/丁比肩/乙偏印, no 偏財) |
| 戊申 | "帶偏印" | → "帶偏財" (申 has 庚食神/壬偏財/戊比肩, no 偏印) |
| 庚戌 | "帶傷官" | → "帶正官" (戌 has 戊偏印/辛劫財/丁正官, no 傷官) |
| 辛亥 | "帶偏財" | → "帶正財" (甲→辛 diff polarity = 正財) |
| 壬戌 | "帶偏財" | → "帶正財" (丁→壬 diff polarity = 正財) |

### NOT AN ISSUE (confirmed by research)
- 丁酉 九醜日: KEEP. 丁酉 IS in the canonical 九醜日 list per multiple sources.

## Implementation
Python script: read JSON → apply 11 targeted string replacements → write back → verify.

## Verification
1. Run computational cross-check: for each of the 11 combos, verify the gradeReason ten god matches `get_ten_god(dm, hidden_stem)`
2. `python -m pytest tests/test_cross_pillar.py tests/test_explanations.py --tb=short` — all pass
3. Grep for any remaining "正印" in 丁卯, "正官" in 戊寅, "正財" in 丁酉 to ensure no stragglers
