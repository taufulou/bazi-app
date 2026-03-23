# V6 — Tone & Format Consistency Fixes (Rev 2)

**Goal**: Make 感情合盤 AI output match the gold standard tone/format of 八字終身運 and 八字愛情姻緣.

**Scope**: Prompt changes in `apps/api/src/ai/prompts.ts` + minor NestJS interpolation in `ai.service.ts`. No Python or frontend changes.

---

## Issue 1: Inconsistent sub-header labels

**Problem**: `marriage_advice` uses custom labels (核心優勢/關鍵風險/經營策略) instead of standard (💕 優勢亮點 / ⚠️ 注意事項 / 💡 實戰建議).

**Fix**: Add explicit rule to `marriage_advice` section rules (line 3036):
```
- marriage_advice 必須使用標準三段結構（💕 優勢亮點 / ⚠️ 注意事項 / 💡 實戰建議），不可自行更改標籤名稱（禁止使用「核心優勢」「關鍵風險」「經營策略」等替代名稱）
```

---

## Issue 2: Mixed bullet format (paragraphs vs `- ` bullets)

**Problem**: `love_personality`, `spouse_enrichment`, `marriage_wealth` use paragraphs inside sub-headers. Other sections correctly use `- ` bullet points.

**Fix**: Add ONE global bullet format rule in `COMPAT_ROMANCE_V2_STYLE_RULES` core principles section (after line 2953):

```
- ⚠️ 每個子標題（💕/⚠️/💡）下方的內容必須使用「- 」開頭的條列格式，每條 2-4 句話。禁止使用長段落，禁止把所有內容寫成一大段文字。例外：chart_profile_a/b 使用流暢段落（不適用此規則）
```

**Per staff review**: No per-section bullet restatements needed — the global rule covers all sections. Only keep section-specific *content* instructions (not format).

---

## Issue 3: Ten-god raw terms visible without explanation

**Problem**: AI outputs raw ten-god names like "年柱正印透出" without explaining what they mean. User feedback: keep the technical reference but ADD the explanation alongside it.

**Fix**: Replace lines 2964-2986 with new "保留技術名+附加白話解釋" approach:

```
術語翻譯規則（⚠️「保留技術名+附加白話解釋」模式）：

  十神引用規則：
  · 引用十神名稱時，必須附加白話解釋。格式：「十神名（白話解釋）」
  · 例：「正印（包容體諒特質）」「食神（浪漫表達力）」
  · 例：「年柱正印透出（代表你外在展現包容體諒的特質）」
  · 例：「配偶星正財純正（代表你對伴侶專一守護）」

  十神白話解釋對照表：
  · 正官 → 「責任承諾型特質」（女命配偶星時：「穩定型伴侶星」）
  · 七殺/偏官 → 「果斷行動力」（女命配偶星時：「激情型伴侶星」）
  · 正財 → 「務實穩定力」（男命配偶星時：「穩定型伴侶星」）
  · 偏財 → 「社交魅力」（男命配偶星時：「多元吸引力型伴侶星」）
  · 食神 → 「浪漫表達力」
  · 傷官 → 「感性魅力」「叛逆吸引力」
  · 正印 → 「包容體諒特質」「安全感」
  · 偏印 → 「獨特品味」「神秘吸引力」
  · 比肩 → 「堅持自我」「同伴型」
  · 劫財 → 「競爭分享」「第三者風險」

  ⚠️ 與 Rule 15（十神翻譯權威規則）的優先級：
  · 若錨點數據中有「→」符號的翻譯（如 crossTenGods 區塊），以錨點翻譯為準
  · 其他十神引用（AI 自行撰寫的敘述文字中）則使用上述「十神名（白話解釋）」格式

  其他術語翻譯（直接替換，不保留原文）：
  · 日主 → 「核心特質」「本質」
  · 用神 → 「最強加持」「升級加持」
  · 忌神 → 「減益效果」「隱藏地雷」
  · 配偶星 → 「理想伴侶星」「姻緣星」
  · 桃花 → 「感情吸引力」
  · 大運 → 「大運」（保留此詞）
  · 五行 → 「五行」（保留）
  · 六沖 → 「衝突」
  · 六害 → 「暗傷」
  · 六合 → 「和合」
  · 三合 → 「助力」
  · 空亡 → 「虛位」
```

**Also update Rule 15** (line 3086) to resolve contradiction:
```
15. ⚠️ 十神翻譯權威規則：錨點數據中「→」符號後的翻譯為該錨點區塊的唯一正確翻譯，不可自行替換。AI 自行撰寫的敘述文字中引用十神時，則使用「十神名（白話解釋）」格式（見術語翻譯規則）
```

---

## Issue 4: Raw GanZhi stem/branch names in AI output

**Problem**: AI output contains raw stems/branches like "乙巳大運", "午火中藏有正印丁火", "劫財己土".

**Fix**: Add GanZhi ban rule to `COMPAT_ROMANCE_V2_STYLE_RULES` (after translation rules). Per staff review, scope to **AI-generated narrative text only**, with explicit exceptions for anchor data reproduction:

```
⚠️ 天干地支敘述禁止規則（與八字終身運、愛情姻緣一致）：
在 AI 自行撰寫的敘述文字中，禁止出現天干名稱（甲乙丙丁戊己庚辛壬癸）和地支名稱（子丑寅卯辰巳午未申酉戌亥）。

例外情況（僅限以下場景可保留天干地支）：
1. 引用預分析錨點數據中的天干地支標識符（如 marriage_wealth 中 lpGanZhi 欄位的大運名稱「己亥」「丁酉」等）— 因為這些是預分析提供的確定性標識符，AI 必須忠實引用
2. 天干合化的組合名（如「丁壬合」），但後面必須附加白話解釋
3. chart_profile_a/b 中的年柱名（如「丁卯年」），但建議改用西曆年份+季節描述

在 AI 自行撰寫的敘述中（非引用錨點標識符時）：
  ✗「乙巳大運」→ ✓「30-39歲的大運」
  ✗「甲辰大運」→ ✓「40-49歲的大運」
  ✗「午火中藏有正印丁火」→ ✓「婚姻宮藏有正印（包容體諒特質）」
  ✗「劫財己土」→ ✓「劫財（競爭分享的能量）」
  ✗「大運天干乙木是忌神」→ ✓「30-39歲大運主導能量為減益效果（忌神）」
  ✗「大運天干丁重複命局正印」→ ✓「10-19歲大運出現天干伏吟（重複正印特質）」

天干合化特例：
  ✓「丁壬合化木（代表你們之間有一種特殊的化學反應，轉化出的能量對男方不利）」
  — 保留「丁壬合」名稱，但後面必須接白話解釋

判斷原則：如果天干地支名稱出現在錨點數據的引號或欄位值中，AI 可以忠實引用；如果是 AI 自行推斷或描述，則必須使用年齡區間或白話表述替代。
```

---

## Issue 5: chart_profile shows raw birth pillars

**Problem**: Current output starts with "你是丁卯年、戊申月、戊午日、庚申時出生的人".

**Fix in prompts.ts**: Update `chart_profile_a/b` section rules (line 2988):

```
- 禁止列出完整的四柱干支（如「丁卯年、戊申月、戊午日、庚申時」）
- 開頭改用親切的出生描述：「你是{{birthYear}}年{{birthSeason}}出生、屬{{zodiac}}的人」
- 出生年份用西曆年份 + 季節（春夏秋冬），不用農曆月份
- 生肖可以提及（已在錨點數據中提供）
```

**Fix in ai.service.ts** — Add to `interpolateCompatV2ChartFields()`:

Data extraction paths:
- `birthYearA`: From `calculationData.chartA.solarDate` → parse year (e.g., "1987-9-6" → 1987). If not available, derive from `calculationData.birthDateA` or `comparison.birthDate1`
- `birthSeasonA`: From `chartA.fourPillars.month.branch` using `BRANCH_TO_SEASON` map:
  ```typescript
  const BRANCH_TO_SEASON: Record<string, string> = {
    '寅': '春天', '卯': '春天', '辰': '春天',
    '巳': '夏天', '午': '夏天', '未': '夏天',
    '申': '秋天', '酉': '秋天', '戌': '秋天',
    '亥': '冬天', '子': '冬天', '丑': '冬天',
  };
  ```
- `zodiacA`: From `chartA.fourPillars.year.branch` using `BRANCH_TO_ZODIAC` map:
  ```typescript
  const BRANCH_TO_ZODIAC: Record<string, string> = {
    '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔',
    '辰': '龍', '巳': '蛇', '午': '馬', '未': '羊',
    '申': '猴', '酉': '雞', '戌': '狗', '亥': '豬',
  };
  ```

Add these to the chart_profile context block:
```
出生描述：{{birthYearA}}年{{birthSeasonA}}出生，屬{{zodiacA}}
```

---

## Staff Review Resolutions

| Review Issue | Resolution |
|-------------|-----------|
| #1 (Low): Redundant bullet rules | ✅ Fixed — only global rule, no per-section restatements |
| #2 (Low): "大運" translation divergence | ✅ Documented — compat keeps "大運", love uses "感情階段". Intentional. |
| #3 (Medium): Birth data extraction path | ✅ Fixed — specified exact paths for birthYear (solarDate), season (month branch), zodiac (year branch) |
| #4 (Medium-High): Rule 15 contradiction | ✅ Fixed — Rule 15 amended to scope to anchor `→` translations only; new rule covers AI narrative text |
| #5 (High): GanZhi ban vs lpGanZhi | ✅ Fixed — scoped ban to "AI-generated narrative" with explicit anchor-reproduction exception |
| #6 (High): Anchor fidelity conflict | ✅ Fixed — added "判斷原則" paragraph clarifying anchor data vs AI narrative distinction |

---

## Implementation Order

| Step | File | Changes |
|------|------|---------|
| 1 | `prompts.ts` | Replace translation rules (Issue 3): "保留技術名+附加白話解釋" mode + amend Rule 15 |
| 2 | `prompts.ts` | Add GanZhi narrative ban (Issue 4): scoped to AI text, anchor exceptions |
| 3 | `prompts.ts` | Add global bullet format rule (Issue 2) |
| 4 | `prompts.ts` | Standardize marriage_advice labels (Issue 1) |
| 5 | `prompts.ts` | Update chart_profile rules (Issue 5): birth year + season + zodiac |
| 6 | `ai.service.ts` | Add BRANCH_TO_SEASON, BRANCH_TO_ZODIAC maps + interpolation |
| 7 | Rebuild NestJS | `nest build && node --import tsx dist/main.js` |

**Files changed**: 2 files only (`prompts.ts`, `ai.service.ts`)
**Lines changed**: ~80 lines in prompts.ts, ~30 lines in ai.service.ts
**No Python changes, no frontend changes**
