# AI Prompt Engineering — Lessons Learned & Rules

> Extracted from CLAUDE.md. Read this when working on AI prompts, `prompts.ts`, `ai.service.ts`, or debugging AI reading accuracy.

## Critical Bug History
| Reading | Bug | Root Cause | Fix |
|---|---|---|---|
| Roger5 | AI fabricated wrong pillars (甲 as month stem, 丙 as hour stem) | No anti-hallucination rules in prompt; AI "computed" its own pillars | Added "絕對禁止" + "天干與藏干的區別" sections to BASE_SYSTEM_PROMPT |
| Roger6 | "please provide data" — empty AI output | DB `prompt_templates` (48 rows) overrode hardcoded prompts with wrong placeholders | Deactivated all 48 DB templates (`is_active=false`) |
| Roger7 | Used "偏強" instead of correct "中和" | Two conflicting strength fields: legacy `strength=strong` vs V2 `classification=neutral`; AI picked legacy | Reordered V2 first with ⚠️ marker; added "日主強弱判定規則" constraint |
| Roger8 | 100% accuracy (58/58 checks) | All fixes applied | — |

## Anti-Hallucination Rules (in `prompts.ts` BASE_SYSTEM_PROMPT)
The AI WILL fabricate Bazi data if not explicitly constrained. These rules are MANDATORY:

1. **"絕對禁止" section** — 5 absolute prohibitions:
   - Never compute/modify Four Pillars (must use provided data verbatim)
   - Never promote hidden stems (藏干) to manifest stems (天干)
   - Never fabricate stem+branch combinations

2. **"天干與藏干的區別" section** — Prevents the #1 hallucination pattern:
   - Only 4 manifest stems exist (年干/月干/日干/時干)
   - Hidden stems must be labeled "藏於X支"
   - 格局 is defined by month branch hidden stem (e.g., 申中藏庚→食神格), but 庚 is NOT the month stem
   - "透干" status must match the preAnalysis `touganAnalysis` list exactly

3. **"日主強弱判定規則" section** — Prevents strength misclassification:
   - V2 strength (marked with ⚠️) takes absolute priority over legacy strength
   - AI must use the exact V2 classification term (極弱/偏弱/中和/偏強/極旺)
   - AI must NEVER override or "reinterpret" the system's strength assessment

4. **"驗證規則" section** — Cross-check rule:
   - Every pillar reference must match 【四柱排盤】 data exactly
   - Year/month/day/hour pillar references are individually constrained

## AI Prompt Constraints (Phase 11C)
**System prompt rules (BASE_SYSTEM_PROMPT in prompts.ts):**
1. "絕對不可以自行推算四柱天干地支" — must use provided data verbatim
2. "絕對不可以將藏干當作天干使用" — hidden stems ≠ manifest stems
3. "數據中標有⚠️的日主強弱欄位是最終結論" — V2 strength takes absolute priority
4. "只有在透干清單中被標為透干的才算透干" — no guessing transparency
5. "驗證規則：提到任何天干地支必須確認與四柱排盤完全一致"

**Content rules:**
6. "所有分析必須完全基於提供的預分析結果和原始數據"
7. "重點分析段落必須引用命主具體天干地支，概要段落可適當概括"
8. "趨勢預測而非絕對事件"
9. "full 每section約500-800字，至少300字"
10. "預分析提供基礎框架，但請根據整體命局靈活調整，避免機械套用單一規則"

## Prompt Placeholder Reference
`interpolateTemplate()` in `ai.service.ts` recognizes these placeholders (and ONLY these):
```
{{gender}}, {{birthDate}}, {{birthTime}}, {{lunarDate}}, {{trueSolarTime}}
{{yearPillar}}, {{monthPillar}}, {{dayPillar}}, {{hourPillar}}
{{yearTenGod}}, {{monthTenGod}}, {{hourTenGod}}
{{yearHidden}}, {{monthHidden}}, {{dayHidden}}, {{hourHidden}}
{{pillarElements}}, {{lifeStages}}, {{kongWang}}
{{dayMaster}}, {{dayMasterElement}}, {{dayMasterYinYang}}
{{strength}}, {{strengthScore}}, {{strengthV2}}
{{pattern}}, {{sameParty}}, {{oppositeParty}}
{{favorableGod}}, {{usefulGod}}, {{tabooGod}}, {{enemyGod}}
{{wood}}, {{fire}}, {{earth}}, {{metal}}, {{water}}
{{luckPeriods}}, {{shenSha}}, {{yearNaYin}}, {{dayNaYin}}
{{preAnalysis}}
```
**NEVER use `{{calculation_data}}`, `{{name}}`, `{{birth_date}}` — these are NOT recognized and will pass through as literal text, causing the AI to receive no data.**

## DB Prompt Template Override Behavior
`buildPrompt()` in `ai.service.ts` (line ~520-531) checks `prompt_templates` DB table FIRST. If an active template exists for the reading type + provider, it COMPLETELY OVERRIDES the hardcoded prompt in `prompts.ts`. This means:
- DB templates must use the exact same `{{placeholder}}` names as listed above
- If DB templates have wrong placeholders, AI receives literal `{{calculation_data}}` text instead of actual data
- Current state: all 48 DB templates are `is_active=false` — system uses hardcoded `prompts.ts` (which is correct and validated)
- If re-enabling DB templates: copy placeholder format from `prompts.ts` LIFETIME template as reference

## Output Quality Factors
| Factor | Setting | Location |
|---|---|---|
| Token budget | `max_tokens: 8192` | `ai.service.ts` |
| Per-section length | "full 約500-800字" | `prompts.ts` OUTPUT_FORMAT_INSTRUCTIONS |
| Minimum length | "至少 300 字 per section" | `prompts.ts` OUTPUT_FORMAT_INSTRUCTIONS |
| Rich input data | preAnalysis JSON (~200-300 tokens) | `interpretation_rules.py` → `ai.service.ts` `formatPreAnalysis()` |
| Specificity | Anti-hallucination rules force data citation | `prompts.ts` BASE_SYSTEM_PROMPT |

## Validation Methodology
When testing AI reading accuracy, run a comprehensive check covering:
1. **Structure**: JSON has all expected sections with preview/full, each full ≥300 chars
2. **Four Pillars**: All 4 correct pillars present, no fabricated pillars
3. **Stem attribution**: Month/hour stems match data, hidden stems not promoted
4. **Strength classification**: Uses V2 term (中和/偏強/etc.), no legacy override
5. **Ten Gods & Pattern**: Correct 格局, correct Ten God per pillar
6. **Luck periods**: Referenced from data, not fabricated
7. **透干 handling**: Matches preAnalysis touganAnalysis list
8. **Anti-hallucination**: No "please provide", no English, no markdown fences
See `/tmp/validate_roger8.mjs` for a full 58-check validation script template.

## Cache Clearing After Prompt Changes
After ANY prompt modification, you MUST clear both cache layers or users will get stale readings:
```bash
redis-cli FLUSHALL
/opt/homebrew/opt/postgresql@15/bin/psql -U bazi_user -d bazi_platform -c "DELETE FROM reading_cache;"
```
Then rebuild NestJS: `cd apps/api && ../../node_modules/.bin/nest build`
