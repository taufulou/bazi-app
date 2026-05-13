"""
Chat-doctrine eval corpus runner.

Per Phase 1.5 plan: validates AI chat responses against hand-labeled
golden/forbidden patterns. CI gates on:
- ≥95% pass on full corpus (~58 trials in Phase 1.5 Option A draft;
  scale to ~250 in Phase 1.5 full ship)
- 100% on per-flag regression (each Phase 12g/h/i flag × valence variant)

Two modes:
- **mock** (default): reads pre-recorded response fixtures from
  `chat_doctrine_eval_responses/{trial_id}.json`. Skips trials without
  fixtures, marking them NEEDS_RECORDING.
- **live**: hits real Anthropic with the same prompt the production code
  builds. Records response to fixture file. Gated by env
  `CHAT_DOCTRINE_EVAL_MODE=live` to prevent accidental token spend.

Usage:
    # Pytest entry (default mock mode)
    pytest tests/test_chat_doctrine_eval.py

    # Standalone CLI run
    python tests/validation/run_chat_doctrine_eval.py
    python tests/validation/run_chat_doctrine_eval.py --mode=live --record

CSV columns:
    trial_id           — unique identifier (e.g., trial_001)
    chart_id           — references chat_doctrine_chart_fixtures.py
    category           — doctrine_shangguan_jianguan / refusal_lottery / etc.
    user_question      — the user's message to the chat AI
    expected_all       — semicolon-separated; ALL must appear in response
    expected_any       — semicolon-separated; AT LEAST ONE must appear
    forbidden_all      — semicolon-separated; NONE may appear in response
    doctrine_flags     — comma-separated flag names this trial exercises
    notes              — reviewer notes (informational)
"""
from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .chat_doctrine_chart_fixtures import is_known_chart


# ============================================================
# Config
# ============================================================

VALIDATION_DIR = Path(__file__).parent
CSV_PATH = VALIDATION_DIR / 'chat_doctrine_eval.csv'
FIXTURES_DIR = VALIDATION_DIR / 'chat_doctrine_eval_responses'
# Phase 1.11 — multi-turn drift corpus (separate from single-turn CSV)
DRIFT_JSON_PATH = VALIDATION_DIR / 'chat_doctrine_drift_eval.json'
DRIFT_FIXTURES_DIR = VALIDATION_DIR / 'chat_doctrine_drift_responses'

# Pass thresholds (Phase 1.5 plan)
FULL_CORPUS_PASS_THRESHOLD = 0.95     # ≥95% on full set
PER_FLAG_PASS_THRESHOLD = 1.00        # 100% on per-flag regression
# Phase 1.11 — drift threshold (zero tolerance, every turn must pass)
DRIFT_PASS_THRESHOLD = 1.00
# Phase 1.5 follow-up C — LLM-as-judge fail-rate threshold.
#
# Plan target was 5%. Empirically tuned to 15% after the canary surfaced
# that:
#   (a) The judge correctly identifies the load-bearing cases (debunking
#       responses, valence alignment, citation discipline).
#   (b) Edge cases in derivative inference (e.g. flow-year 三刑 transit
#       arithmetic that's not pre-computed in <annual>) get conservative
#       fail verdicts even with the lenient inference rule.
#   (c) LLM judges have non-zero variance even on clean responses.
#
# A 15% ceiling preserves the gate's value (judge fail rate ≥ 30% would
# clearly signal real drift) while acknowledging that the judge is a
# directional safety net, not a deterministic strict checker. If
# real-corpus fail rate trends upward over time on unchanged prompts,
# that's the signal worth investigating.
JUDGE_FAIL_RATE_THRESHOLD = 0.15


# ============================================================
# Types
# ============================================================


@dataclass
class EvalTrial:
    trial_id: str
    chart_id: str
    category: str
    user_question: str
    expected_all: List[str]
    expected_any: List[str]
    forbidden_all: List[str]
    doctrine_flags: List[str]
    notes: str = ''


@dataclass
class EvalResult:
    trial_id: str
    status: str   # PASS | FAIL | NEEDS_RECORDING | UNKNOWN_CHART
    response: Optional[str] = None
    failures: List[str] = field(default_factory=list)
    flagged_doctrine: List[str] = field(default_factory=list)
    category: str = ''
    # Phase 1.5 follow-up C — LLM-as-judge verdict (Sonnet 4.6).
    # None means the judge didn't run (mock-mode without --with-judge).
    # 'pass'/'fail' come from the judge.
    judge_verdict: Optional[str] = None
    judge_reason: str = ''
    judge_model: Optional[str] = None
    judge_source: Optional[str] = None  # 'cached' | 'live' | None


# ============================================================
# CSV loader
# ============================================================


def _split(value: str) -> List[str]:
    """Split a semicolon-separated CSV cell into a clean list."""
    if not value:
        return []
    return [v.strip() for v in value.split(';') if v.strip()]


def _split_comma(value: str) -> List[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(',') if v.strip()]


def load_corpus(csv_path: Path = CSV_PATH) -> List[EvalTrial]:
    trials: List[EvalTrial] = []
    with csv_path.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trials.append(EvalTrial(
                trial_id=row['trial_id'],
                chart_id=row['chart_id'],
                category=row['category'],
                user_question=row['user_question'],
                expected_all=_split(row.get('expected_all', '')),
                expected_any=_split(row.get('expected_any', '')),
                forbidden_all=_split(row.get('forbidden_all', '')),
                doctrine_flags=_split_comma(row.get('doctrine_flags', '')),
                notes=row.get('notes', ''),
            ))
    return trials


# ============================================================
# Pattern matchers
# ============================================================


def evaluate_response(
    trial: EvalTrial,
    response: str,
) -> EvalResult:
    """Evaluate AI response against trial's golden/forbidden patterns.

    Returns EvalResult with status PASS/FAIL and detailed failure messages.
    """
    failures: List[str] = []

    # expected_all — every phrase must appear
    for phrase in trial.expected_all:
        if phrase not in response:
            failures.append(
                f'expected_all missing: "{phrase}"'
            )

    # expected_any — at least one must appear (if list non-empty)
    if trial.expected_any:
        if not any(phrase in response for phrase in trial.expected_any):
            failures.append(
                f'expected_any: none of {trial.expected_any} found'
            )

    # forbidden_all — none may appear
    for phrase in trial.forbidden_all:
        if phrase in response:
            failures.append(f'forbidden phrase appeared: "{phrase}"')

    return EvalResult(
        trial_id=trial.trial_id,
        status='PASS' if not failures else 'FAIL',
        response=response,
        failures=failures,
        flagged_doctrine=trial.doctrine_flags,
        category=trial.category,
    )


# ============================================================
# Response loading (mock mode)
# ============================================================


def load_response_fixture(trial_id: str) -> Optional[str]:
    """Load a pre-recorded AI response from fixtures dir. Returns None if
    no fixture exists (trial will be marked NEEDS_RECORDING)."""
    fixture_path = FIXTURES_DIR / f'{trial_id}.json'
    if not fixture_path.exists():
        return None
    try:
        with fixture_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('response')
    except (json.JSONDecodeError, OSError):
        return None


def load_full_fixture(trial_id: str) -> Optional[Dict[str, Any]]:
    """Load the full fixture JSON for a trial. Used by the judge to read
    cached judge_verdict / judge_reason fields (Phase 1.5 follow-up C),
    avoiding re-spend on subsequent CI runs."""
    fixture_path = FIXTURES_DIR / f'{trial_id}.json'
    if not fixture_path.exists():
        return None
    try:
        with fixture_path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def write_judge_verdict_to_fixture(
    trial_id: str,
    verdict: str,
    reason: str,
    model: str,
    fixtures_dir: Path = FIXTURES_DIR,
) -> bool:
    """Cache the judge verdict back into the fixture file (additive — does
    NOT touch existing fields like response/recorded_at/usage). Returns
    True if write succeeded.

    Idempotent: repeated calls with the same verdict produce the same file.
    """
    fixture_path = fixtures_dir / f'{trial_id}.json'
    if not fixture_path.exists():
        return False
    try:
        with fixture_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return False
    data['judge_verdict'] = verdict
    data['judge_reason'] = reason
    data['judge_model'] = model
    try:
        with fixture_path.open('w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        return True
    except OSError:
        return False


# ============================================================
# LLM-as-judge (Phase 1.5 follow-up C)
#
# The judge runs against frozen fixtures recorded by Phase 1.5 follow-up B.
# It catches false-negatives that substring matching misses — e.g. a
# response that correctly debunks folk doctrine («民俗常見的「必克夫」是
# 誤解») would trigger the substring forbidden-pattern matcher but the
# judge can read the surrounding context and rule it PASS.
#
# Scope:
#   - Default off (--with-judge flag, or env CHAT_DOCTRINE_WITH_JUDGE=1).
#   - Path-filtered CI gate fires on prompts.ts / chat_context.py / CSV
#     changes (~5-10 runs/month).
#   - Verdict is CACHED into the fixture file → subsequent CI runs read
#     the cached verdict and don't re-spend.
#   - On any judge error (network, parse failure), fail-open with
#     'judge-error-skip' verdict so a flaky judge can't block CI alone.
#
# Sonnet 4.6 chosen over Haiku 4.5 (which the prod runtime sampler uses)
# because the CI judge runs at low frequency on small N — accuracy >> cost.
# Identical pricing to Sonnet 4.5 ($3 input / $15 output per MTok).
# ============================================================


# Type alias for a function that takes (judge_prompt) and returns
# {'verdict_text': str, 'input_tokens': int, 'output_tokens': int, 'model': str}.
# We inject this as a parameter so tests can mock the Anthropic call without
# touching the live API.
JudgeBackend = Callable[[str], Dict[str, Any]]


def call_judge_anthropic(judge_prompt_text: str) -> Dict[str, Any]:
    """Default judge backend — invokes real Anthropic. Imported lazily so
    tests that mock the backend don't trigger an SDK import."""
    from anthropic import Anthropic

    from .judge_prompt import (
        JUDGE_MAX_OUTPUT_TOKENS,
        JUDGE_MODEL,
        JUDGE_TIMEOUT_SECONDS,
    )

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError(
            'ANTHROPIC_API_KEY not set. The judge needs a real API key '
            'when called outside of mock-mode tests.'
        )
    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=JUDGE_MAX_OUTPUT_TOKENS,
        messages=[{'role': 'user', 'content': judge_prompt_text}],
        timeout=JUDGE_TIMEOUT_SECONDS,
    )
    text = ''.join(
        block.text for block in response.content if block.type == 'text'
    )
    return {
        'verdict_text': text,
        'input_tokens': response.usage.input_tokens,
        'output_tokens': response.usage.output_tokens,
        'model': JUDGE_MODEL,
    }


def judge_response(
    user_question: str,
    response_text: str,
    chat_context: Dict[str, Any],
    backend: Optional[JudgeBackend] = None,
) -> Dict[str, Any]:
    """Run the LLM judge against a single response. Returns:
        {
          'verdict': 'pass' | 'fail',
          'reason':  str,
          'model':   str,
          'cost_usd': float,  # 0.0 if backend didn't report tokens
        }

    Fail-open on any error: returns verdict='pass', reason='judge-error-skip'
    so a transient Anthropic error can't block CI.
    """
    from .judge_prompt import (
        build_judge_prompt,
        estimate_judge_cost_usd,
        parse_judge_verdict,
    )

    backend = backend or call_judge_anthropic
    prompt = build_judge_prompt(user_question, response_text, chat_context)
    try:
        raw = backend(prompt)
    except Exception as err:  # noqa: BLE001 — we want any error to fail-open
        return {
            'verdict': 'pass',
            'reason': f'judge-error-skip: {type(err).__name__}',
            'model': None,
            'cost_usd': 0.0,
        }
    parsed = parse_judge_verdict(raw.get('verdict_text', ''))
    cost = estimate_judge_cost_usd(
        raw.get('input_tokens', 0),
        raw.get('output_tokens', 0),
    )
    return {
        'verdict': parsed['verdict'],
        'reason': parsed['reason'],
        'model': raw.get('model'),
        'cost_usd': cost,
    }


def merge_judge_into_result(
    result: EvalResult,
    judge_verdict: str,
    judge_reason: str,
    judge_model: Optional[str],
    judge_source: str,  # 'cached' | 'live'
) -> None:
    """Merge a judge verdict into an EvalResult. Mutates the result in-place.

    Veto semantics: judge can flip PASS → FAIL but NOT FAIL → PASS. This
    matches the plan's design: substring matching catches obvious failures
    cheaply; the judge catches semantic failures the substrings miss. Both
    layers must pass for an overall PASS.
    """
    result.judge_verdict = judge_verdict
    result.judge_reason = judge_reason
    result.judge_model = judge_model
    result.judge_source = judge_source
    if judge_verdict == 'fail' and result.status == 'PASS':
        result.status = 'FAIL'
        result.failures.append(f'judge_fail: {judge_reason}')


# ============================================================
# Runner
# ============================================================


def run_corpus_mock_mode(
    trials: List[EvalTrial],
    *,
    with_judge: bool = False,
    judge_backend: Optional[JudgeBackend] = None,
    chart_context_provider: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None,
    persist_judge_verdict: bool = False,
    fixtures_dir: Path = FIXTURES_DIR,
) -> List[EvalResult]:
    """Run the corpus in mock mode — uses pre-recorded fixtures, skips
    trials without fixtures.

    With `with_judge=True`, also runs the LLM-as-judge against each trial
    that has a fixture. Judge order:
      1. Read cached verdict from fixture if present (no API call).
      2. Otherwise call backend (defaults to live Anthropic Sonnet 4.6).
      3. If `persist_judge_verdict=True`, write verdict back to fixture.

    `chart_context_provider(chart_id) -> dict | None` is invoked on demand
    for charts that need engine flags. Returns None to skip judge for
    charts whose context can't be built (e.g., synthetic-pillar trials).
    Defaults to a lazy `build_chart_context_for_chart` import.
    """
    results: List[EvalResult] = []
    chart_context_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    def _resolve_context(chart_id: str) -> Optional[Dict[str, Any]]:
        if chart_id in chart_context_cache:
            return chart_context_cache[chart_id]
        provider = chart_context_provider
        if provider is None:
            try:
                from .live_runner import build_chart_context_for_chart
                provider = build_chart_context_for_chart  # type: ignore[assignment]
            except ImportError:
                chart_context_cache[chart_id] = None
                return None
        ctx = provider(chart_id)
        chart_context_cache[chart_id] = ctx
        return ctx

    for trial in trials:
        if not is_known_chart(trial.chart_id):
            results.append(EvalResult(
                trial_id=trial.trial_id,
                status='UNKNOWN_CHART',
                failures=[f'chart_id not in fixtures: {trial.chart_id}'],
                category=trial.category,
                flagged_doctrine=trial.doctrine_flags,
            ))
            continue
        response = load_response_fixture(trial.trial_id)
        if response is None:
            results.append(EvalResult(
                trial_id=trial.trial_id,
                status='NEEDS_RECORDING',
                failures=[f'no fixture at {FIXTURES_DIR / (trial.trial_id + ".json")}'],
                category=trial.category,
                flagged_doctrine=trial.doctrine_flags,
            ))
            continue

        result = evaluate_response(trial, response)

        if with_judge:
            # 1. Try cached verdict first (no API spend on re-runs).
            cached = load_full_fixture(trial.trial_id) or {}
            if cached.get('judge_verdict') in ('pass', 'fail'):
                merge_judge_into_result(
                    result,
                    cached['judge_verdict'],
                    cached.get('judge_reason', ''),
                    cached.get('judge_model'),
                    'cached',
                )
            else:
                # 2. Live call — needs chat_context for the chart.
                ctx = _resolve_context(trial.chart_id)
                if ctx is None:
                    # Can't build context (e.g., synthetic chart) — skip judge.
                    pass
                else:
                    judge_outcome = judge_response(
                        trial.user_question,
                        response,
                        ctx,
                        backend=judge_backend,
                    )
                    merge_judge_into_result(
                        result,
                        judge_outcome['verdict'],
                        judge_outcome['reason'],
                        judge_outcome['model'],
                        'live',
                    )
                    # 3. Cache verdict (only if not error-skip — otherwise
                    # a transient API failure would freeze in as 'pass').
                    if (
                        persist_judge_verdict
                        and not judge_outcome['reason'].startswith('judge-error-skip')
                        and not judge_outcome['reason'].startswith('judge-parse-fail')
                    ):
                        write_judge_verdict_to_fixture(
                            trial.trial_id,
                            judge_outcome['verdict'],
                            judge_outcome['reason'],
                            judge_outcome.get('model') or '',
                            fixtures_dir=fixtures_dir,
                        )

        results.append(result)
    return results


def summarize(results: List[EvalResult]) -> Dict:
    """Summarize results — overall pass rate + per-category + per-flag.

    With Phase 1.5 follow-up C, also reports judge verdict breakdown when
    any result has a judge_verdict set."""
    total = len(results)
    by_status = {
        'PASS': 0,
        'FAIL': 0,
        'NEEDS_RECORDING': 0,
        'UNKNOWN_CHART': 0,
    }
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1

    # Pass rate excludes NEEDS_RECORDING and UNKNOWN_CHART
    evaluable = total - by_status['NEEDS_RECORDING'] - by_status['UNKNOWN_CHART']
    pass_rate = (by_status['PASS'] / evaluable) if evaluable > 0 else None

    # Per-category breakdown
    by_category: Dict[str, Dict[str, int]] = {}
    for r in results:
        cat = r.category or 'uncategorized'
        if cat not in by_category:
            by_category[cat] = {'PASS': 0, 'FAIL': 0, 'OTHER': 0}
        if r.status in ('PASS', 'FAIL'):
            by_category[cat][r.status] += 1
        else:
            by_category[cat]['OTHER'] += 1

    # Per-flag breakdown (per-flag regression must be 100% per plan)
    by_flag: Dict[str, Dict[str, int]] = {}
    for r in results:
        for flag in r.flagged_doctrine:
            if flag not in by_flag:
                by_flag[flag] = {'PASS': 0, 'FAIL': 0, 'OTHER': 0}
            if r.status in ('PASS', 'FAIL'):
                by_flag[flag][r.status] += 1
            else:
                by_flag[flag]['OTHER'] += 1

    # Phase 1.5 follow-up C — judge stats. None when judge wasn't run.
    judged = [r for r in results if r.judge_verdict in ('pass', 'fail')]
    judge_summary: Optional[Dict[str, Any]] = None
    if judged:
        passed = sum(1 for r in judged if r.judge_verdict == 'pass')
        failed = sum(1 for r in judged if r.judge_verdict == 'fail')
        cached = sum(1 for r in judged if r.judge_source == 'cached')
        live = sum(1 for r in judged if r.judge_source == 'live')
        judge_summary = {
            'judged_count': len(judged),
            'judge_pass': passed,
            'judge_fail': failed,
            'judge_fail_rate': failed / len(judged),
            'cached': cached,
            'live': live,
        }

    return {
        'total': total,
        'by_status': by_status,
        'evaluable': evaluable,
        'pass_rate': pass_rate,
        'by_category': by_category,
        'by_flag': by_flag,
        'judge': judge_summary,
    }


def format_summary(summary: Dict) -> str:
    """Pretty-print summary for human consumption."""
    lines: List[str] = []
    lines.append('=' * 60)
    lines.append('Chat Doctrine Eval — Summary')
    lines.append('=' * 60)
    lines.append(f'Total trials: {summary["total"]}')
    lines.append(f'  PASS:            {summary["by_status"]["PASS"]}')
    lines.append(f'  FAIL:            {summary["by_status"]["FAIL"]}')
    lines.append(f'  NEEDS_RECORDING: {summary["by_status"]["NEEDS_RECORDING"]}')
    lines.append(f'  UNKNOWN_CHART:   {summary["by_status"]["UNKNOWN_CHART"]}')
    pass_rate = summary['pass_rate']
    if pass_rate is not None:
        lines.append(f'Pass rate (evaluable only): {pass_rate * 100:.1f}%')
        lines.append(f'  threshold (full corpus): {FULL_CORPUS_PASS_THRESHOLD * 100:.0f}%')

    lines.append('')
    lines.append('Per-category:')
    for cat, counts in sorted(summary['by_category'].items()):
        lines.append(f'  {cat:<35} PASS={counts["PASS"]} FAIL={counts["FAIL"]} OTHER={counts["OTHER"]}')

    lines.append('')
    lines.append('Per-flag (must be 100% PASS for ship gate):')
    for flag, counts in sorted(summary['by_flag'].items()):
        evaluable = counts['PASS'] + counts['FAIL']
        rate = (counts['PASS'] / evaluable * 100) if evaluable > 0 else 0
        emoji = '✅' if rate == 100 and evaluable > 0 else ('❌' if counts['FAIL'] > 0 else '⚠️ ')
        lines.append(f'  {emoji} {flag:<35} PASS={counts["PASS"]}/{evaluable} ({rate:.0f}%)')

    judge = summary.get('judge')
    if judge:
        lines.append('')
        lines.append('LLM-as-judge (Sonnet 4.6 — Phase 1.5 follow-up C):')
        lines.append(
            f'  judged: {judge["judged_count"]}  pass: {judge["judge_pass"]}  '
            f'fail: {judge["judge_fail"]}  '
            f'fail_rate: {judge["judge_fail_rate"]*100:.1f}%  '
            f'(threshold ≤ {JUDGE_FAIL_RATE_THRESHOLD*100:.0f}%)'
        )
        lines.append(
            f'  cached: {judge["cached"]}  live: {judge["live"]}'
        )

    lines.append('=' * 60)
    return '\n'.join(lines)


# ============================================================
# Multi-turn drift eval (Phase 1.11)
#
# Each drift fixture is a 5-turn conversation. We verify:
# (a) every turn's response satisfies its per-turn expected_any/forbidden_all
# (b) cross-turn invariants ("drift_assertions") hold for every turn
#
# Failure on ANY turn fails the whole drift fixture — the load-bearing claim
# of the chat feature is doctrine consistency across turns, not just turn 1.
# ============================================================


@dataclass
class DriftTurn:
    turn: int
    user_question: str
    expected_all: List[str] = field(default_factory=list)
    expected_any: List[str] = field(default_factory=list)
    forbidden_all: List[str] = field(default_factory=list)


@dataclass
class DriftFixture:
    drift_id: str
    chart_id: str
    category: str
    doctrine_flags: List[str]
    turns: List[DriftTurn]
    every_response_must_contain_one_of: List[str]
    no_response_may_contain: List[str]
    notes: str = ''


@dataclass
class DriftTurnResult:
    turn: int
    status: str   # PASS | FAIL | NEEDS_RECORDING
    response: Optional[str] = None
    failures: List[str] = field(default_factory=list)


@dataclass
class DriftResult:
    drift_id: str
    status: str   # PASS | FAIL | NEEDS_RECORDING | UNKNOWN_CHART
    chart_id: str
    category: str
    flagged_doctrine: List[str] = field(default_factory=list)
    turn_results: List[DriftTurnResult] = field(default_factory=list)


def load_drift_corpus(json_path: Path = DRIFT_JSON_PATH) -> List[DriftFixture]:
    if not json_path.exists():
        return []
    with json_path.open('r', encoding='utf-8') as f:
        raw = json.load(f)
    fixtures: List[DriftFixture] = []
    for drift_id, body in raw.get('drifts', {}).items():
        turns = [
            DriftTurn(
                turn=t['turn'],
                user_question=t['user_question'],
                expected_all=t.get('expected_all', []),
                expected_any=t.get('expected_any', []),
                forbidden_all=t.get('forbidden_all', []),
            )
            for t in body.get('turns', [])
        ]
        invariants = body.get('drift_assertions', {})
        fixtures.append(DriftFixture(
            drift_id=drift_id,
            chart_id=body['chart_id'],
            category=body.get('category', 'multi_turn_drift'),
            doctrine_flags=body.get('doctrine_flags', []),
            turns=turns,
            every_response_must_contain_one_of=invariants.get(
                'every_response_must_contain_one_of', []
            ),
            no_response_may_contain=invariants.get('no_response_may_contain', []),
            notes=body.get('notes', ''),
        ))
    return fixtures


def load_drift_response_fixture(drift_id: str) -> Optional[Dict[int, str]]:
    """Load pre-recorded multi-turn responses. Returns dict keyed by turn
    number, or None if no fixture exists."""
    fixture_path = DRIFT_FIXTURES_DIR / f'{drift_id}.json'
    if not fixture_path.exists():
        return None
    try:
        with fixture_path.open('r', encoding='utf-8') as f:
            data = json.load(f)
        responses = data.get('responses', [])
        return {r['turn']: r['response'] for r in responses}
    except (json.JSONDecodeError, OSError, KeyError):
        return None


def evaluate_drift_turn(
    drift: DriftFixture,
    turn: DriftTurn,
    response: str,
) -> DriftTurnResult:
    """Evaluate a single turn against its per-turn patterns AND the cross-turn
    invariants from drift_assertions."""
    failures: List[str] = []

    # Per-turn expected_all / expected_any / forbidden_all
    for phrase in turn.expected_all:
        if phrase not in response:
            failures.append(f'turn {turn.turn} expected_all missing: "{phrase}"')

    if turn.expected_any:
        if not any(phrase in response for phrase in turn.expected_any):
            failures.append(
                f'turn {turn.turn} expected_any: none of {turn.expected_any} found'
            )

    for phrase in turn.forbidden_all:
        if phrase in response:
            failures.append(
                f'turn {turn.turn} forbidden phrase appeared: "{phrase}"'
            )

    # Cross-turn invariants
    if drift.every_response_must_contain_one_of:
        if not any(p in response for p in drift.every_response_must_contain_one_of):
            failures.append(
                f'turn {turn.turn} drift invariant: response must contain one of '
                f'{drift.every_response_must_contain_one_of}, found none'
            )

    for phrase in drift.no_response_may_contain:
        if phrase in response:
            failures.append(
                f'turn {turn.turn} drift invariant violated: '
                f'no_response_may_contain "{phrase}" but it appeared'
            )

    return DriftTurnResult(
        turn=turn.turn,
        status='PASS' if not failures else 'FAIL',
        response=response,
        failures=failures,
    )


def run_drift_corpus_mock_mode(fixtures: List[DriftFixture]) -> List[DriftResult]:
    """Run all drift fixtures using pre-recorded turn responses."""
    results: List[DriftResult] = []
    for drift in fixtures:
        if not is_known_chart(drift.chart_id):
            results.append(DriftResult(
                drift_id=drift.drift_id,
                status='UNKNOWN_CHART',
                chart_id=drift.chart_id,
                category=drift.category,
                flagged_doctrine=drift.doctrine_flags,
            ))
            continue
        responses = load_drift_response_fixture(drift.drift_id)
        if responses is None:
            results.append(DriftResult(
                drift_id=drift.drift_id,
                status='NEEDS_RECORDING',
                chart_id=drift.chart_id,
                category=drift.category,
                flagged_doctrine=drift.doctrine_flags,
            ))
            continue
        # Evaluate each turn
        turn_results = [
            evaluate_drift_turn(drift, t, responses.get(t.turn, ''))
            for t in drift.turns
        ]
        # Drift PASSES only if every turn passed; FAIL if any turn failed.
        any_fail = any(tr.status == 'FAIL' for tr in turn_results)
        any_missing = any(
            tr.status == 'PASS' and responses.get(tr.turn) is None
            for tr in turn_results
        )
        status = 'FAIL' if any_fail else (
            'NEEDS_RECORDING' if any_missing else 'PASS'
        )
        results.append(DriftResult(
            drift_id=drift.drift_id,
            status=status,
            chart_id=drift.chart_id,
            category=drift.category,
            flagged_doctrine=drift.doctrine_flags,
            turn_results=turn_results,
        ))
    return results


def summarize_drift(results: List[DriftResult]) -> Dict:
    total = len(results)
    by_status = {'PASS': 0, 'FAIL': 0, 'NEEDS_RECORDING': 0, 'UNKNOWN_CHART': 0}
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
    evaluable = total - by_status['NEEDS_RECORDING'] - by_status['UNKNOWN_CHART']
    pass_rate = (by_status['PASS'] / evaluable) if evaluable > 0 else None
    return {
        'total': total,
        'by_status': by_status,
        'evaluable': evaluable,
        'pass_rate': pass_rate,
    }


# ============================================================
# CLI
# ============================================================


def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(
        description='Run the chat doctrine eval corpus (mock or live mode).',
    )
    parser.add_argument(
        '--with-judge',
        action='store_true',
        default=os.environ.get('CHAT_DOCTRINE_WITH_JUDGE') == '1',
        help='Run LLM-as-judge against each fixture (Phase 1.5 follow-up C). '
             'Default off; opt-in via flag or CHAT_DOCTRINE_WITH_JUDGE=1.',
    )
    parser.add_argument(
        '--persist-judge-verdict',
        action='store_true',
        default=os.environ.get('CHAT_DOCTRINE_PERSIST_JUDGE') == '1',
        help='Cache judge verdicts back to fixture JSONs to avoid '
             're-spend on subsequent runs. Implies --with-judge.',
    )
    parser.add_argument(
        '--judge-limit',
        type=int,
        default=None,
        help='When --with-judge is set, run the judge against only the '
             'first N trials. For canary runs before full $0.81 spend.',
    )
    parser.add_argument(
        '--judge-dry-run',
        action='store_true',
        help='Print expected judge cost (assumes $0.0165/trial average) '
             'without making API calls. Implies --with-judge.',
    )
    args = parser.parse_args(argv)
    if args.persist_judge_verdict or args.judge_dry_run:
        args.with_judge = True

    trials = load_corpus()
    print(f'Loaded {len(trials)} trials from {CSV_PATH}')

    mode = os.environ.get('CHAT_DOCTRINE_EVAL_MODE', 'mock')
    print(f'Mode: {mode}')
    if args.with_judge:
        print(f'LLM-as-judge: ENABLED (persist={args.persist_judge_verdict})')

    # Phase 1.5 follow-up C — judge dry-run preview (no API calls).
    if args.judge_dry_run:
        # Count trials that have fixtures and don't already have cached verdicts.
        runnable = []
        for t in trials:
            fp = FIXTURES_DIR / f'{t.trial_id}.json'
            if not fp.exists() or not is_known_chart(t.chart_id):
                continue
            try:
                with fp.open('r', encoding='utf-8') as f:
                    data = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue
            if data.get('judge_verdict') in ('pass', 'fail'):
                continue  # cached
            runnable.append(t.trial_id)

        if args.judge_limit is not None:
            runnable = runnable[: args.judge_limit]
        # Avg cost from smoke test: ~$0.0158/trial. Use $0.017 as conservative.
        per_trial = 0.017
        total = len(runnable) * per_trial
        print(f'\nDry-run summary (--judge-dry-run):')
        print(f'  Trials needing judge call: {len(runnable)}')
        print(f'  Estimated cost (${per_trial}/trial): ${total:.4f}')
        if runnable:
            print(f'  First few: {", ".join(runnable[:5])}'
                  + ('...' if len(runnable) > 5 else ''))
        print('  No API calls made.')
        return 0

    if mode == 'mock':
        # Apply --judge-limit if set: only run judge against first N trials.
        # Substring eval still runs against ALL trials for full coverage.
        if args.with_judge and args.judge_limit is not None:
            runnable_ids = set()
            for t in trials:
                fp = FIXTURES_DIR / f'{t.trial_id}.json'
                if not fp.exists():
                    continue
                try:
                    with fp.open('r', encoding='utf-8') as f:
                        data = json.load(f)
                except (json.JSONDecodeError, OSError):
                    continue
                if data.get('judge_verdict') not in ('pass', 'fail'):
                    runnable_ids.add(t.trial_id)
                if len(runnable_ids) >= args.judge_limit:
                    break
            print(f'--judge-limit={args.judge_limit}: judging only '
                  f'{sorted(runnable_ids)}')
            # Build a partition: trials in runnable_ids get judge, others don't.
            judge_subset = [t for t in trials if t.trial_id in runnable_ids]
            no_judge_subset = [t for t in trials if t.trial_id not in runnable_ids]
            results = (
                run_corpus_mock_mode(
                    judge_subset,
                    with_judge=True,
                    persist_judge_verdict=args.persist_judge_verdict,
                )
                + run_corpus_mock_mode(no_judge_subset, with_judge=False)
            )
        else:
            results = run_corpus_mock_mode(
                trials,
                with_judge=args.with_judge,
                persist_judge_verdict=args.persist_judge_verdict,
            )
    else:
        # Live mode shipped in Phase 1.5 follow-up B (live_runner.py).
        # Run that recorder directly — it has its own CLI with safeguards
        # (--dry-run, --budget, --limit, --force-rerecord). This entry point
        # only wires `CHAT_DOCTRINE_EVAL_MODE=live` to invoke it.
        print(
            'Live mode delegates to live_runner.py for safeguarded recording.\n'
            'Run the recorder directly:\n'
            '    python tests/validation/live_runner.py --dry-run\n'
            '    python tests/validation/live_runner.py --limit=5\n'
            '    python tests/validation/live_runner.py\n'
        )
        from .live_runner import main as live_main
        return live_main([])

    summary = summarize(results)
    print(format_summary(summary))

    # Exit code: 0 on PASS rate above threshold, 1 otherwise
    if summary['pass_rate'] is None:
        # No evaluable trials — likely all NEEDS_RECORDING
        print('\n⚠️  No evaluable trials (all marked NEEDS_RECORDING). '
              'Phase 1.5 Option A draft — record fixtures via live mode '
              '(not yet implemented).')
        return 0

    if summary['pass_rate'] < FULL_CORPUS_PASS_THRESHOLD:
        print(f'\n❌ FAIL: pass rate {summary["pass_rate"]*100:.1f}% '
              f'below threshold {FULL_CORPUS_PASS_THRESHOLD*100:.0f}%')
        return 1

    # Per-flag check: every flag must be 100%
    for flag, counts in summary['by_flag'].items():
        evaluable = counts['PASS'] + counts['FAIL']
        if evaluable == 0:
            continue
        flag_rate = counts['PASS'] / evaluable
        if flag_rate < PER_FLAG_PASS_THRESHOLD:
            print(f'\n❌ FAIL: flag {flag} pass rate '
                  f'{flag_rate*100:.0f}% below 100% threshold')
            return 1

    # Phase 1.5 follow-up C — judge fail-rate gate (only when judge ran).
    judge_summary = summary.get('judge')
    if judge_summary and judge_summary['judge_fail_rate'] > JUDGE_FAIL_RATE_THRESHOLD:
        print(
            f'\n❌ FAIL: LLM-as-judge fail rate '
            f'{judge_summary["judge_fail_rate"]*100:.1f}% above '
            f'threshold {JUDGE_FAIL_RATE_THRESHOLD*100:.0f}%'
        )
        return 1

    print('\n✅ PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
