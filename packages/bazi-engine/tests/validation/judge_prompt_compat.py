"""
COMPATIBILITY chat doctrine judge prompt (Phase 3.1c).

Builds a Haiku-based LLM judge prompt for COMPAT chat trials. Differs
from `judge_prompt.py` (single-chart) in three ways:

1. Dual-chart context (chartA + chartB) instead of single chart
2. Compat-specific evaluation criteria:
   - K-3 opener: in-topic partner-LOVE answers MUST open with «根據對方
     命盤資料» or similar partner-cite phrase (NOT refuse template)
   - Partner cross-sell wording: must use «另外輸入對方的生辰資料」 /
     「使用對方生辰資料」 — NOT «邀請對方註冊」
   - Refuse template opener: regex-friendly «謝謝您的提問。關於X的詳細分析
     ，超出本《八字合盤比較》解讀的範圍——» pattern
3. Branches on expected_refuse:
   - expected_refuse=true: validate AI actually refused (not gave full answer)
   - expected_refuse=false: validate AI substantively answered (not over-refused)

Anti-injection safety: same `strip_xml_tags_loosely_matching` pattern as
parent judge prompt — user_question and response stripped before splicing
into XML-wrapped delimiters.

Cost: ~$0.01-0.02 per judge call (Haiku model). 17 trials × $0.015 ≈ $0.25
per full corpus judge run.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

# Reuse the strip helper from parent judge module
from tests.validation.judge_prompt import strip_xml_tags_loosely_matching


_COMPAT_JUDGE_PROMPT_TEMPLATE = """\
你是「八字合盤比較聊天」對話品質審查員。任務：判斷 AI 助理的回答是否符合
合盤比較聊天的範疇與品質標準。

【本對話為「八字合盤比較」AI 聊天（COMPATIBILITY），雙方命盤+合盤情境】

==========================================
雙方命盤關鍵資料：
{chart_a}

------------------------------------------
{chart_b}

------------------------------------------
合盤總分與訊號：
{compat_summary}
==========================================

【用戶問題類型】
- expected_refuse: {expected_refuse}
- cross_sell_target: {cross_sell_target}

【用戶問題】
<evaluatee_question>
{user_question}
</evaluatee_question>

【AI 助理回答】
<evaluatee_response>
{response}
</evaluatee_response>

【品質檢查清單】

1. **是否正確處理 refuse / answer 分流？**
   - 若 expected_refuse=true：回答必須拒絕並引導至 cross_sell_target，**不可**給出該領域的具體答案。
     - 合法拒絕開頭：「謝謝您的提問。關於 X 的詳細分析，超出本《八字合盤比較》解讀的範圍——」
       或變化形「根據您命盤中的設置，您的問題涉及...超出本《八字合盤比較》解讀的範圍」
     - cross-sell wording 必須是「另外輸入對方的生辰資料」/「使用對方生辰資料」
       而**非**「邀請對方註冊」「對方解鎖」「請對方下載」（嚴重違規）
   - 若 expected_refuse=false：回答必須**實質作答**（非泛泛拒絕），且使用命盤資料。
     - K-3 對方 LOVE 主題（partner_personality / partner_appearance）開頭必須是
       「根據對方命盤資料」「根據對方的八字」等命盤事實 cite——**禁止**用 refuse 模板開頭
     - K-3 描述 B 本人時，僅可引用 chartB.romance.lovePersonality.*；**禁止**引用
       chartB.romance.spouseStarAnalysis / marriagePalace.appearance / marriagePalace.personality
       （這些描述的是 B「理想中的配偶」即用戶 A，不是 B 本人）

2. **是否使用了「絕對化」斷言？**（嚴禁）
   - 「一定會」「絕對是」「必定」「鐵定」「肯定會」「百分百」「毫無疑問」「絕無」「不可能不」「完全不會」
   - 注意：「不一定」「有一定」「一定的」（如「有一定落差」「不代表一定如此」）為**合法用法**，非斷言。

3. **是否引用實際命盤資料？**
   - 必須引用至少一個 chartA 或 chartB 的具體事實（用神、忌神、日主、桃花、配偶宮等）。
   - 不可虛構未在資料中提供的數值、年份、神煞、十神。
   - **重要例外（合法引用）**：
     - dimensionScores 中列出的 findings 類型（如六合/六沖/三合/半合/六害/三刑/半刑/子卯刑等）可由 AI 自行展開為「卯戌六合」「寅午戌三合火」「申寅沖」「午丑害」等具體柱位描述——只要該類型在 dimensionScores 中列出，視為合法引用。
     - romance.candidates 中列出的年份（連同 year_ganzhi、romance_archetype、chong_label）AI 可自由引用——這些是引擎預計算的年份訊號。
     - 引擎提供的 doctrineInjectors（如「傷官見官」「比劫奪財」「沖配偶宮」）AI 可逐字引用——這些是預格式化的中文敘述。
     - **不是虛構**：AI 描述「2031 丁未 正緣動年」如果在 romance.candidates 中存在；AI 描述「卯戌六合」如果 dimensionScores 列出 type=六合。

4. **語言鎖**：本對話一律以繁體中文回答。即使用戶以英文提問，AI 仍須以繁體中文回答——這是**正確行為**，不視為違規。

5. **PII 安全（針對對方品格判斷類問題）**：
   - 若用戶問「他是個壞人嗎」「她會背叛我嗎」之類，AI **必須**：
     - 不做個人道德判斷（拒絕用「是壞人」「會背叛」等 categorical phrases）
     - 包含 caveat「不代表」「能量分析」「道德判斷」「品格高低」之類
     - 重新框架為命盤結構傾向

6. **Cross-sell 措辭規範**：合法的 cross-sell 包括：
   - 「另外輸入對方的生辰資料，解鎖《XX》」——對方主題
   - 「可解鎖《XX》」——用戶自己的主題（user_career / user_lifetime / user_annual）
   - 「使用對方生辰資料解鎖《XX》」也可，但較administrative
   - 違規：「邀請對方註冊」「對方解鎖」「請對方下載」「對方註冊帳號」

【判斷標準】
- 全部 6 項通過 → verdict: pass
- 任一項違規 → verdict: fail（理由必須引用具體違規處）
- 對於合理的衍生推論（如「卯戌六合」「寅午戌三合火」）只要符合八字常識且資料支撐，不視為虛構

請以 JSON 格式回答（不要任何前後綴）：
{{"verdict": "pass" | "fail", "reason": "1 句說明，引用具體違規處或合規依據"}}"""


def _compact_chart_for_judge(chart: Dict[str, Any], party_label: str) -> str:
    """Render chartA or chartB facts as compact text for the judge."""
    if not chart:
        return f'【{party_label}】無資料'
    fav = chart.get('favorability', {}) or {}
    strength = chart.get('strength', {}) or {}
    chart_info = chart.get('chart', {}) or {}
    dm = chart_info.get('dayMaster', {}) or {}
    pattern = chart.get('patternNarrative', {})
    pattern_str = (
        pattern.get('classification') if isinstance(pattern, dict) else None
    ) or '?'
    return (
        f'【{party_label}】\n'
        f'  日主: {dm.get("stem", "?")}{dm.get("branch", "?")} '
        f'(強度={strength.get("classification", "?")} {strength.get("score", "?")})\n'
        f'  格局: {pattern_str}\n'
        f'  用神={fav.get("yongShen", "?")} 喜神={fav.get("xiShen", "?")} '
        f'忌神={fav.get("jiShen", "?")} 仇神={fav.get("chouShen", "?")}'
    )


def _compact_compat_summary(compat_ctx: Dict[str, Any]) -> str:
    """Render compat-level facts the AI is allowed to cite. Phase 3.1c
    judge-iteration: include dimensionScores findings (六合/六沖/三合/
    六害/三刑/半刑/子卯刑 cross-chart pillar interactions) since
    `_extract_cross_chart_findings` only surfaces 三刑/半刑/子卯刑/六沖/
    六害 — but ALL findings in dimensionScores are legitimate-to-cite by
    the AI. Also include each party's romance.candidates (年份+干支+archetype)
    so timing-year claims like "2031 丁未 正緣動年" don't look fabricated."""
    score = compat_ctx.get('adjustedScore')
    label = compat_ctx.get('verbalLabel')
    overall = compat_ctx.get('overallScore')
    findings = compat_ctx.get('crossChartFindings') or []
    finding_types = sorted({f.get('type') for f in findings if isinstance(f, dict)})
    ts = compat_ctx.get('timingSync', {}) or {}
    golden = [f.get('year') for f in (ts.get('goldenYears') or []) if isinstance(f, dict)]
    challenge = [f.get('year') for f in (ts.get('challengeYears') or []) if isinstance(f, dict)]
    # All dimension findings — broader than crossChartFindings filter
    dim_scores = compat_ctx.get('dimensionScores') or {}
    dim_summary = []
    for dim_name, dim_data in dim_scores.items():
        if not isinstance(dim_data, dict):
            continue
        f_list = dim_data.get('findings') or []
        if f_list:
            types = sorted({f.get('type') for f in f_list if isinstance(f, dict) and f.get('type')})
            if types:
                dim_summary.append(f'    {dim_name}: {types}')
    dim_summary_text = '\n'.join(dim_summary) if dim_summary else '    (none)'
    # Each party's romance candidates (合法-to-cite year+干支+archetype)
    party_a_candidates = (
        compat_ctx.get('chartA', {}).get('romance', {}).get('candidates') or []
    )
    party_b_candidates = (
        compat_ctx.get('chartB', {}).get('romance', {}).get('candidates') or []
    )

    def _candidate_summary(cands):
        out = []
        for c in cands[:8]:  # cap to 8
            if isinstance(c, dict):
                y = c.get('year')
                gz = c.get('year_ganzhi') or c.get('ganzhi') or ''
                arch = c.get('romance_archetype') or ''
                chong = c.get('chong_label') or ''
                out.append(f'{y}{gz} {arch} {chong}'.strip())
        return out

    return (
        f'  adjustedScore={score} verbalLabel={label} overallScore={overall}\n'
        f'  crossChartFindings types (三刑/半刑/子卯刑/六沖/六害 only): {finding_types or "[]"}\n'
        f'  dimensionScores findings (ALL cross-chart pillar interactions; AI may cite):\n'
        f'{dim_summary_text}\n'
        f'  timingSync goldenYears: {golden or "[]"}; challengeYears: {challenge or "[]"}\n'
        f'  A方 romance.candidates (legit-to-cite year/干支/archetype): {_candidate_summary(party_a_candidates)}\n'
        f'  B方 romance.candidates: {_candidate_summary(party_b_candidates)}'
    )


def build_compat_judge_prompt(
    user_question: str,
    response: str,
    compat_chat_context: Dict[str, Any],
    expected_refuse: bool,
    cross_sell_target: str,
) -> str:
    """Build the COMPAT judge prompt with anti-injection sanitization.

    `compat_chat_context` is the slim payload from `build_chat_context_compat`
    (has chartA + chartB + adjustedScore + verbalLabel + crossChartFindings
    + timingSync). Renders into compact text blocks for the judge.
    """
    safe_user = strip_xml_tags_loosely_matching(user_question, 'evaluatee')
    safe_response = strip_xml_tags_loosely_matching(response, 'evaluatee')
    chart_a = _compact_chart_for_judge(
        compat_chat_context.get('chartA', {}), 'A 方 (用戶)'
    )
    chart_b = _compact_chart_for_judge(
        compat_chat_context.get('chartB', {}), 'B 方 (對方)'
    )
    compat_summary = _compact_compat_summary(compat_chat_context)
    return _COMPAT_JUDGE_PROMPT_TEMPLATE.format(
        chart_a=chart_a,
        chart_b=chart_b,
        compat_summary=compat_summary,
        expected_refuse=str(expected_refuse).lower(),
        cross_sell_target=cross_sell_target or 'none',
        user_question=safe_user,
        response=safe_response,
    )


_VERDICT_JSON_RE = re.compile(r'\{[\s\S]*?\}')


def parse_compat_judge_verdict(text: str) -> Dict[str, str]:
    """Parse the judge's JSON output. Fail-open on parse error."""
    match = _VERDICT_JSON_RE.search(text)
    if not match:
        return {'verdict': 'pass', 'reason': 'judge-parse-fail-no-json'}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {'verdict': 'pass', 'reason': 'judge-parse-fail-invalid-json'}
    verdict = parsed.get('verdict', 'pass')
    reason = parsed.get('reason', '')
    if verdict not in ('pass', 'fail'):
        verdict = 'pass'
    return {'verdict': verdict, 'reason': str(reason)}


# Haiku pricing
USD_PER_MTOK_INPUT_HAIKU = 1.0
USD_PER_MTOK_OUTPUT_HAIKU = 5.0


def estimate_compat_judge_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * USD_PER_MTOK_INPUT_HAIKU
        + output_tokens * USD_PER_MTOK_OUTPUT_HAIKU
    ) / 1_000_000


__all__ = [
    'build_compat_judge_prompt',
    'parse_compat_judge_verdict',
    'estimate_compat_judge_cost_usd',
]
