# Future Enhancement: Deep Pre-Analysis for AI Consistency (Phase 13+)

> Extracted from CLAUDE.md. Read this when planning Phase 13 or working on AI reading consistency improvements.

## Problem
The current `preAnalysis` JSON provides **structural findings** (what relationships exist, what Ten Gods are where, what the strength score is). But AI readings still have inconsistency issues:

1. **Interpretation depth varies** -- same 正財在日支 finding could produce a 2-sentence or 10-sentence interpretation depending on AI mood
2. **Cross-section contradictions** -- career section says "適合穩定工作" but personality section says "冒險精神強" without reconciling
3. **Missing causal chains** -- AI states "事業順利" without explaining WHY
4. **Inconsistent severity grading** -- one reading treats 月日沖 as minor, another as catastrophic
5. **Lost context across sections** -- love section doesn't reference the career Ten God insight

## Vision: Narrative-Ready Pre-Analysis

Instead of just structural data, pre-analysis should output **narrative building blocks** -- pre-written interpretive fragments that the AI assembles into a coherent reading. This shifts AI's job from "interpret data -> write" to "arrange + connect pre-written insights -> write transitions".

## Proposed Data Structure

```python
# Enhanced preAnalysis output (future):
{
    # Layer A: Everything from current Phase 11 (unchanged)
    ...

    # Layer B: Interpretive fragments -- pre-written Chinese text blocks
    "interpretiveFragments": {
        "personality": [
            {
                "text": "日主丁火生於寅月，木火相生，性格溫和而有內在熱情。丁火如燭光，照亮他人但不灼傷。",
                "confidence": 0.95,
                "sourceRule": "day_master_element_character",
                "appliesTo": ["personality", "love"],
                "priority": 1,
            },
            {
                "text": "食神在月柱透干，才華早顯，善於表達，適合以創意為生。",
                "confidence": 0.90,
                "sourceRule": "ten_god_position_month_食神",
                "appliesTo": ["personality", "career"],
                "priority": 2,
            },
        ],
        "career": [...],
        "love": [...],
        "health": [...],
        "timing": [...],
    },

    # Layer C: Cross-section consistency constraints
    "consistencyConstraints": [
        {
            "rule": "if_career_says_stable_then_personality_must_not_say_adventurous",
            "resolution": "career takes priority from 正官格, personality should say '外表穩重但內心有創意衝動'",
            "affectedSections": ["personality", "career"],
        },
        {
            "rule": "severity_grading",
            "月日沖": "medium_high",
            "年時沖": "low",
            "日支空亡": "high_for_love",
        },
    ],

    # Layer D: Causal chains -- explain WHY, not just WHAT
    "causalChains": [
        {
            "chain": "食神格 → 食傷生財 → 才華轉化為收入 → 適合自由職業或創意產業",
            "sections": ["career", "finance"],
            "keyStems": ["食神", "正財"],
        },
    ],

    # Layer E: Section-specific word count targets + tone
    "sectionGuidance": {
        "personality": {
            "wordCount": {"min": 300, "max": 500},
            "tone": "warm_insightful",
            "mustInclude": ["日主特質", "格局影響", "核心性格矛盾"],
            "mustNotInclude": ["具體年份預測"],
        },
        "career": {
            "wordCount": {"min": 400, "max": 600},
            "tone": "practical_advisory",
            "mustInclude": ["適合行業", "用神方向", "大運時機"],
            "mustReference": ["personality.食神 insight"],
        },
    },
}
```

## Why This Matters for Consistency

| Current Issue | How Deep Pre-Analysis Fixes It |
|---|---|
| AI writes different depth each time | `sectionGuidance.wordCount` + `mustInclude` list ensures coverage |
| Cross-section contradictions | `consistencyConstraints` explicitly resolve conflicts before AI sees them |
| Missing "why" explanations | `causalChains` give AI the logical reasoning to narrate |
| Severity grading varies | Standardized severity scores (not left to AI judgment) |
| Sections feel disconnected | `appliesTo` tags + `mustReference` create explicit cross-links |
| Same chart -> different readings each call | Pre-written `interpretiveFragments` ensure core insights are deterministic |

## Implementation Approach

1. **Phase 13A**: Add `interpretiveFragments` -- ~200 template strings in Chinese. Highest-value addition.
2. **Phase 13B**: Add `consistencyConstraints` and `causalChains` -- conflict resolution and reasoning chains.
3. **Phase 13C**: Add `sectionGuidance` -- per-section tone/length/coverage constraints.

## Token Budget
- Current preAnalysis: ~200-300 tokens
- With Layer B-E: ~800-1200 tokens estimated
- Total prompt with preAnalysis: ~2000-2500 tokens (within Claude's context easily)

## Storage
- Store in `calculationData` JSONB column for now (simplest)
- Split to separate `preAnalysisData` column if it exceeds 20KB
- Redis cache only is an option since it's deterministic from birth data
