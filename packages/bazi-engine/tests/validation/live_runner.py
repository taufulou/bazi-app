"""
Live mode recorder for the chat doctrine eval corpus (Phase 1.5 follow-up B).

Records real Anthropic Sonnet 4.5 responses for the unrecorded trials in
`chat_doctrine_eval.csv` (currently 53 of 58 trials lack fixtures). Saves
each response as `chat_doctrine_eval_responses/{trial_id}.json` so the
existing pytest mock-mode runner can replay them in CI.

Cost
----
Per trial: ~$0.0375 (10k input × $3/MTok + ~500 output × $15/MTok).
Total expected for 49 real-birth trials: ~$1.84.
**Hard cap: $10** (5× safety buffer; abort if accumulated cost exceeds it).
The 4 synthetic-chart trials are skipped — they require hand-crafted
chart_data dicts that bypass calculate_bazi (deferred to Phase A).

Safeguards (per Phase 1.5 follow-up B plan)
-------------------------------------------
1. Per-trial cost dry-run preview (--dry-run flag prints estimates only).
2. Hard $10 abort threshold (--budget=N to override).
3. Batch by category — refusal first (cheapest, validates pipeline at low
   cost), then doctrine, then timing.
4. Resume-on-failure — skips trials whose fixture already exists. Idempotent.

Plus: --limit=N flag for pre-flight 5-trial canary; manual operator
inspection between canary and full run is recommended.

Usage
-----
    # 1. Dry-run — see all 49 cost estimates, no API calls
    python tests/validation/live_runner.py --dry-run

    # 2. Canary — 5 trials, ~$0.20 actual spend, operator inspects fixtures
    python tests/validation/live_runner.py --limit=5

    # 3. Full run — resume-on-failure picks up from canary
    python tests/validation/live_runner.py

Model lock
----------
Hardcoded to `claude-sonnet-4-5-20250929`, matching production
(`apps/api/src/chat/chat-stream.service.ts::this.model`). DO NOT change
the model without:
  - Bumping `CHAT_V1_PROMPT_VERSION` in prompts.ts
  - Re-running the Bazi-master 3-agent prompt review
  - Re-recording all fixtures on the new model

Caching
-------
This runner does NOT use Anthropic prompt caching. Production caches the
system block at 1h TTL because users have multi-turn sessions; the
recorder makes 49 independent one-shot calls. Adding cache_control here
would save ~$1 for ~50 lines of plumbing — not worth the complexity for
a one-shot operation.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Allow running as both `python live_runner.py` (CLI) and
# `from tests.validation.live_runner import ...` (pytest). Sys.path setup
# only kicks in for the CLI path.
_THIS_DIR = Path(__file__).resolve().parent
_ENGINE_ROOT = _THIS_DIR.parent.parent  # packages/bazi-engine
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))

from app.calculator import calculate_bazi_with_all_pipelines  # noqa: E402
from app.chat_context import build_chat_context  # noqa: E402

# Use absolute imports so the file works both as a CLI script
# (`python live_runner.py`) and as an imported module
# (`from tests.validation.live_runner import ...`).
from tests.validation.chat_doctrine_chart_fixtures import (  # noqa: E402
    get_chart_birth_params,
    get_chart_synthetic_pillars,
    is_known_chart,
)
from tests.validation.chat_v1_prompt_python import (  # noqa: E402
    CHAT_V1_PROMPT_VERSION_LOCAL,
    build_chat_v1_system_prompt_header,
)


# ============================================================
# Constants — locked to match production
# ============================================================


# Phase 1.5 follow-up C iter 2: upgraded to Sonnet 4.6 to test whether
# stronger instruction-following reduces the persistent fabrication rate
# we saw in iter 1 (Sonnet 4.5 ignored anti-fabrication rules even when
# tightened — 39.6% judge fail rate). Sonnet 4.6 has identical pricing
# ($3 input / $15 output per MTok) so this is a free experiment.
#
# If the experiment succeeds (judge fail rate < 15%), production
# `CLAUDE_MODEL` env in chat-stream.service.ts / chat.service.ts should
# also be upgraded to claude-sonnet-4-6 to keep the model-lock principle:
# recordings should match what real users get.
#
# If the experiment fails, revert to claude-sonnet-4-5-20250929.
LIVE_RECORDING_MODEL = 'claude-sonnet-4-6'

# Anthropic Sonnet 4.x pricing per million tokens (USD).
USD_PER_MTOK_INPUT = 3.0
USD_PER_MTOK_OUTPUT = 15.0

# Production max_tokens — matches chat-stream.service.ts.
MAX_OUTPUT_TOKENS = 800

# Default hard cap — 5× safety buffer over $1.84 expected spend.
# Override with --budget=N at the CLI for backfill runs.
DEFAULT_BUDGET_USD = 10.0

# CSV / fixtures paths
VALIDATION_DIR = _THIS_DIR
CSV_PATH = VALIDATION_DIR / 'chat_doctrine_eval.csv'
FIXTURES_DIR = VALIDATION_DIR / 'chat_doctrine_eval_responses'

# Category order for batching (refusal first — cheapest, validates pipeline).
CATEGORY_ORDER = (
    # Refusals first — short responses, cheapest, validates pipeline at low cost
    'refusal_lottery', 'refusal_medical', 'refusal_legal', 'refusal_death',
    'refusal_third_party', 'refusal_stock',
    # Doctrine
    'doctrine_shangguan_jianguan', 'doctrine_bijie_duocai',
    'doctrine_guan_sha_hun_za', 'doctrine_chong_pei_ou_gong',
    'doctrine_spouse_palace_friction',
    # Timing
    'timing_career', 'timing_romance', 'timing_finance', 'timing_health',
    'timing_dayun',
    # Multi-turn
    'multi_turn_regrounding', 'multi_turn_regrounding_fail', 'multi_turn_drift',
    # Concept redirect / locale / probabilistic / cross-sell / fabrication
    'redirect_concept', 'language_lock', 'cross_sell',
    'probabilistic_language', 'probabilistic_test',
    'fabrication_test',
    # Identity / relationships / personality / direction-color
    'identity_self', 'relationships_partner', 'personality',
    'direction_color', 'boss_strategy', 'parents_analysis',
    'children_analysis',
)


# ============================================================
# Types
# ============================================================


@dataclass
class TrialEstimate:
    trial_id: str
    chart_id: str
    category: str
    user_question: str
    estimated_input_tokens: int
    estimated_cost_usd: float
    skip_reason: Optional[str] = None  # 'synthetic_chart', 'fixture_exists', 'unknown_chart'


@dataclass
class RecordingResult:
    trial_id: str
    status: str  # 'recorded' | 'skipped' | 'aborted_budget' | 'error'
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    error: Optional[str] = None


@dataclass
class RunSummary:
    total_attempted: int = 0
    recorded: int = 0
    skipped_existing: int = 0
    skipped_synthetic: int = 0
    aborted_budget: int = 0
    errors: int = 0
    total_cost_usd: float = 0.0
    per_trial: List[RecordingResult] = field(default_factory=list)


# ============================================================
# Slim chart-context build (real-birth only; synthetic charts skipped)
# ============================================================


def build_chart_context_for_chart(
    chart_id: str,
    current_year: int = 2026,
    current_month: int = 5,
) -> Optional[Dict]:
    """Build chat_context for a real-birth chart. Returns None for
    synthetic-only charts (the live runner skips those).

    The synthetic charts in chat_doctrine_chart_fixtures.py use direct
    pillar substitution which bypasses calculate_bazi — porting that
    construction into the live runner is out of scope for B (deferred
    to Phase A).
    """
    birth_params = get_chart_birth_params(chart_id)
    if birth_params is None:
        return None  # synthetic chart — caller should skip
    full_chart = calculate_bazi_with_all_pipelines(
        birth_date=birth_params['birth_date'],
        birth_time=birth_params['birth_time'],
        birth_city=birth_params['birth_city'],
        birth_timezone=birth_params['birth_timezone'],
        gender=birth_params['gender'],
        target_year=birth_params.get('target_year') or current_year,
    )
    return build_chat_context(
        full_chart,
        current_year=current_year,
        current_month=current_month,
    )


def build_full_system_prompt(chat_context: Dict) -> str:
    """Compose the full system prompt sent to Anthropic, mirroring
    `chat-prompt-builder.ts::buildPrompt()` system-prompt assembly."""
    sections: List[str] = [build_chat_v1_system_prompt_header()]

    # Doctrine injectors (pre-formatted Chinese sentences)
    injectors = chat_context.get('doctrineInjectors') or {}
    injector_blocks = [
        v for v in injectors.values() if v not in (None, '')
    ]
    if injector_blocks:
        sections.append('\n【教義旗標 — 必須引用以下文字作為主敘述基礎】\n')
        sections.append('\n\n'.join(injector_blocks))

    # Slim chat context as JSON
    sections.append('\n【命盤資料】\n')
    sections.append('```json\n' + json.dumps(chat_context, ensure_ascii=False, indent=2) + '\n```')

    return '\n'.join(sections)


# ============================================================
# Cost estimation
# ============================================================


# Use the SDK's count_tokens on first call, but allow a cheap fallback for
# tests. Token count is always slightly off (anthropic.count_tokens uses an
# approximation) — fine for budget gating, not for invoicing.
def estimate_input_tokens(text: str) -> int:
    """Rough approximation: 1 token ≈ 3.5 chars for mixed zh/en text."""
    # Closer for zh-TW than the 4-chars-per-token English heuristic.
    return max(1, len(text) // 3)


def estimate_cost_usd(input_tokens: int, max_output_tokens: int = MAX_OUTPUT_TOKENS) -> float:
    """Estimate worst-case cost: full input + max output."""
    input_cost = input_tokens * USD_PER_MTOK_INPUT / 1_000_000
    output_cost = max_output_tokens * USD_PER_MTOK_OUTPUT / 1_000_000
    return input_cost + output_cost


# ============================================================
# Trial loading + ordering
# ============================================================


def load_trials(csv_path: Path = CSV_PATH):
    """Wrap run_chat_doctrine_eval.load_corpus (deferred to avoid circular import).
    Uses absolute import so the file works as both CLI and module."""
    from tests.validation.run_chat_doctrine_eval import load_corpus
    return load_corpus(csv_path)


def category_sort_key(category: str) -> Tuple[int, str]:
    """Return (priority, category) for stable sort. Unknown categories go last."""
    try:
        priority = CATEGORY_ORDER.index(category)
    except ValueError:
        priority = len(CATEGORY_ORDER)
    return (priority, category)


def order_trials_by_category(trials: List) -> List:
    return sorted(
        trials,
        key=lambda t: (category_sort_key(t.category), t.trial_id),
    )


# ============================================================
# Estimation pass (used by --dry-run)
# ============================================================


def estimate_all(
    trials: List,
    fixtures_dir: Path = FIXTURES_DIR,
    force_rerecord: bool = False,
    current_year: int = 2026,
    current_month: int = 5,
) -> List[TrialEstimate]:
    """Build per-trial cost estimates without making any API calls."""
    estimates: List[TrialEstimate] = []
    # Cache chat_context per chart_id — multiple trials per chart.
    context_cache: Dict[str, Optional[Dict]] = {}

    for trial in trials:
        # Resume-on-failure: check fixture
        fixture_path = fixtures_dir / f'{trial.trial_id}.json'
        if fixture_path.exists() and not force_rerecord:
            estimates.append(TrialEstimate(
                trial_id=trial.trial_id,
                chart_id=trial.chart_id,
                category=trial.category,
                user_question=trial.user_question,
                estimated_input_tokens=0,
                estimated_cost_usd=0.0,
                skip_reason='fixture_exists',
            ))
            continue

        # Unknown chart
        if not is_known_chart(trial.chart_id):
            estimates.append(TrialEstimate(
                trial_id=trial.trial_id,
                chart_id=trial.chart_id,
                category=trial.category,
                user_question=trial.user_question,
                estimated_input_tokens=0,
                estimated_cost_usd=0.0,
                skip_reason='unknown_chart',
            ))
            continue

        # Synthetic chart — skip in live mode (deferred to Phase A)
        if get_chart_synthetic_pillars(trial.chart_id) is not None:
            estimates.append(TrialEstimate(
                trial_id=trial.trial_id,
                chart_id=trial.chart_id,
                category=trial.category,
                user_question=trial.user_question,
                estimated_input_tokens=0,
                estimated_cost_usd=0.0,
                skip_reason='synthetic_chart',
            ))
            continue

        # Build / reuse context for this chart
        if trial.chart_id not in context_cache:
            context_cache[trial.chart_id] = build_chart_context_for_chart(
                trial.chart_id, current_year, current_month,
            )
        chat_context = context_cache[trial.chart_id]
        if chat_context is None:
            estimates.append(TrialEstimate(
                trial_id=trial.trial_id,
                chart_id=trial.chart_id,
                category=trial.category,
                user_question=trial.user_question,
                estimated_input_tokens=0,
                estimated_cost_usd=0.0,
                skip_reason='no_context',
            ))
            continue

        # Build prompt + estimate cost
        system_prompt = build_full_system_prompt(chat_context)
        input_tokens = estimate_input_tokens(system_prompt + trial.user_question)
        cost = estimate_cost_usd(input_tokens)
        estimates.append(TrialEstimate(
            trial_id=trial.trial_id,
            chart_id=trial.chart_id,
            category=trial.category,
            user_question=trial.user_question,
            estimated_input_tokens=input_tokens,
            estimated_cost_usd=cost,
        ))
    return estimates


def format_dry_run(estimates: List[TrialEstimate]) -> str:
    lines: List[str] = []
    lines.append('=' * 70)
    lines.append('LIVE RECORDER — DRY RUN (no API calls)')
    lines.append('=' * 70)
    by_skip: Dict[str, int] = {}
    runnable_total = 0.0
    runnable_count = 0
    runnable_lines: List[str] = []
    for e in estimates:
        if e.skip_reason:
            by_skip[e.skip_reason] = by_skip.get(e.skip_reason, 0) + 1
        else:
            runnable_total += e.estimated_cost_usd
            runnable_count += 1
            runnable_lines.append(
                f'  {e.trial_id:<10} {e.chart_id:<35} {e.category:<32} '
                f'~{e.estimated_input_tokens} in tokens  ${e.estimated_cost_usd:.4f}'
            )

    lines.append(f'Total trials:  {len(estimates)}')
    lines.append(f'  Runnable:    {runnable_count}')
    for reason, n in sorted(by_skip.items()):
        lines.append(f'  Skip ({reason}): {n}')
    lines.append('')
    lines.append(f'Estimated total cost (worst-case max_tokens={MAX_OUTPUT_TOKENS}): ${runnable_total:.2f}')
    lines.append(f'Hard cap (default): ${DEFAULT_BUDGET_USD:.2f}')
    lines.append('')
    if runnable_total > DEFAULT_BUDGET_USD:
        lines.append(f'⚠️  ESTIMATE EXCEEDS DEFAULT CAP — would abort mid-run.')
        lines.append(f'   Use --budget={runnable_total + 5:.0f} to override if intended.')
        lines.append('')
    lines.append('Per-trial breakdown:')
    lines.extend(runnable_lines)
    lines.append('=' * 70)
    return '\n'.join(lines)


# ============================================================
# Recording (live API path)
# ============================================================


def call_anthropic(
    system_prompt: str,
    user_question: str,
    model: str = LIVE_RECORDING_MODEL,
) -> Dict:
    """Make the actual Anthropic API call. Returns dict with response text +
    usage. Caller is responsible for cost accounting + fixture writing."""
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError(
            'ANTHROPIC_API_KEY env var is not set. Set it via:\n'
            '  export ANTHROPIC_API_KEY="$(cat ~/.anthropic-key)"'
        )

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system_prompt,
        messages=[{'role': 'user', 'content': user_question}],
    )
    # Concatenate text blocks (single-turn responses always have 1 block)
    response_text = ''.join(
        b.text for b in response.content if hasattr(b, 'text')
    )
    return {
        'response_text': response_text,
        'input_tokens': response.usage.input_tokens,
        'output_tokens': response.usage.output_tokens,
        'model': response.model,
    }


def actual_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        input_tokens * USD_PER_MTOK_INPUT / 1_000_000
        + output_tokens * USD_PER_MTOK_OUTPUT / 1_000_000
    )


def write_fixture(
    fixtures_dir: Path,
    trial_id: str,
    chart_id: str,
    user_question: str,
    response_text: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    prompt_version: str,
) -> Path:
    fixture_path = fixtures_dir / f'{trial_id}.json'
    payload = {
        'trial_id': trial_id,
        'chart_id': chart_id,
        'user_question': user_question,
        'response': response_text,
        'model': model,
        'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'usage': {
            'input_tokens': input_tokens,
            'output_tokens': output_tokens,
            'cost_usd': actual_cost_usd(input_tokens, output_tokens),
        },
        'prompt_version': prompt_version,
    }
    with fixture_path.open('w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return fixture_path


def record_one(
    trial,
    fixtures_dir: Path,
    chat_context: Dict,
    budget_remaining: float,
) -> RecordingResult:
    """Record a single trial's response. Returns RecordingResult.

    Caller is responsible for the resume-on-failure check (skip-if-exists).
    `record_one` always proceeds to record (overwriting if fixture exists),
    which is what `--force-rerecord` flow expects. The audit caught a
    redundant skip-if-exists guard here that broke `--force-rerecord` —
    removed.
    """
    system_prompt = build_full_system_prompt(chat_context)

    # Pre-flight cost check before spending
    estimated_input = estimate_input_tokens(system_prompt + trial.user_question)
    estimated_cost = estimate_cost_usd(estimated_input)
    if estimated_cost > budget_remaining:
        return RecordingResult(
            trial_id=trial.trial_id,
            status='aborted_budget',
            error=(
                f'estimated ${estimated_cost:.4f} > remaining budget '
                f'${budget_remaining:.4f}'
            ),
        )

    try:
        api_response = call_anthropic(system_prompt, trial.user_question)
    except Exception as e:
        return RecordingResult(
            trial_id=trial.trial_id,
            status='error',
            error=str(e),
        )

    cost = actual_cost_usd(
        api_response['input_tokens'], api_response['output_tokens']
    )
    write_fixture(
        fixtures_dir=fixtures_dir,
        trial_id=trial.trial_id,
        chart_id=trial.chart_id,
        user_question=trial.user_question,
        response_text=api_response['response_text'],
        model=api_response['model'],
        input_tokens=api_response['input_tokens'],
        output_tokens=api_response['output_tokens'],
        prompt_version=CHAT_V1_PROMPT_VERSION_LOCAL,
    )

    return RecordingResult(
        trial_id=trial.trial_id,
        status='recorded',
        cost_usd=cost,
        input_tokens=api_response['input_tokens'],
        output_tokens=api_response['output_tokens'],
    )


def run_with_safeguards(
    trials: List,
    fixtures_dir: Path = FIXTURES_DIR,
    budget_usd: float = DEFAULT_BUDGET_USD,
    limit: Optional[int] = None,
    force_rerecord: bool = False,
    current_year: int = 2026,
    current_month: int = 5,
    on_progress=None,
) -> RunSummary:
    """Main recording loop. Skips synthetic charts + already-recorded trials.
    Aborts if accumulated cost would exceed budget_usd.
    """
    summary = RunSummary()
    # Cache chat_context per chart_id
    context_cache: Dict[str, Optional[Dict]] = {}
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    ordered = order_trials_by_category(trials)

    for trial in ordered:
        if limit is not None and summary.recorded >= limit:
            break
        summary.total_attempted += 1

        # Resume-on-failure
        fixture_path = fixtures_dir / f'{trial.trial_id}.json'
        if fixture_path.exists() and not force_rerecord:
            summary.skipped_existing += 1
            summary.per_trial.append(RecordingResult(
                trial_id=trial.trial_id, status='skipped',
            ))
            if on_progress:
                on_progress(f'SKIP {trial.trial_id} (fixture exists)')
            continue

        # Synthetic chart — skip in live mode
        if get_chart_synthetic_pillars(trial.chart_id) is not None:
            summary.skipped_synthetic += 1
            summary.per_trial.append(RecordingResult(
                trial_id=trial.trial_id, status='skipped',
                error='synthetic chart — Phase A scope',
            ))
            if on_progress:
                on_progress(f'SKIP {trial.trial_id} (synthetic chart)')
            continue

        # Build/reuse chart context
        if trial.chart_id not in context_cache:
            try:
                context_cache[trial.chart_id] = build_chart_context_for_chart(
                    trial.chart_id, current_year, current_month,
                )
            except Exception as e:
                summary.errors += 1
                summary.per_trial.append(RecordingResult(
                    trial_id=trial.trial_id, status='error',
                    error=f'chart context build failed: {e}',
                ))
                continue
        chat_context = context_cache[trial.chart_id]
        if chat_context is None:
            summary.skipped_synthetic += 1
            summary.per_trial.append(RecordingResult(
                trial_id=trial.trial_id, status='skipped',
                error='no chart context (synthetic-only)',
            ))
            continue

        # Record
        budget_remaining = budget_usd - summary.total_cost_usd
        result = record_one(
            trial, fixtures_dir, chat_context, budget_remaining,
        )
        summary.per_trial.append(result)
        summary.total_cost_usd += result.cost_usd

        if result.status == 'recorded':
            summary.recorded += 1
            if on_progress:
                on_progress(
                    f'OK   {trial.trial_id} ({trial.category}) '
                    f'${result.cost_usd:.4f} (total ${summary.total_cost_usd:.2f})'
                )
        elif result.status == 'aborted_budget':
            summary.aborted_budget += 1
            if on_progress:
                on_progress(
                    f'ABORT (budget) {trial.trial_id}: {result.error}'
                )
            break
        else:
            summary.errors += 1
            if on_progress:
                on_progress(
                    f'ERR  {trial.trial_id}: {result.error}'
                )

    return summary


# ============================================================
# CLI
# ============================================================


def _parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--dry-run', action='store_true',
                   help='Print cost estimates without making any API calls')
    p.add_argument('--budget', type=float, default=DEFAULT_BUDGET_USD,
                   help=f'Hard cost cap in USD (default: ${DEFAULT_BUDGET_USD:.2f})')
    p.add_argument('--limit', type=int, default=None,
                   help='Stop after N successful recordings (for canary runs)')
    p.add_argument('--force-rerecord', action='store_true',
                   help='Re-record trials even if their fixture already exists')
    p.add_argument('--current-year', type=int, default=2026)
    p.add_argument('--current-month', type=int, default=5)
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    trials = load_trials()

    if args.dry_run:
        ordered = order_trials_by_category(trials)
        estimates = estimate_all(
            ordered,
            force_rerecord=args.force_rerecord,
            current_year=args.current_year,
            current_month=args.current_month,
        )
        print(format_dry_run(estimates))
        return 0

    summary = run_with_safeguards(
        trials,
        budget_usd=args.budget,
        limit=args.limit,
        force_rerecord=args.force_rerecord,
        current_year=args.current_year,
        current_month=args.current_month,
        on_progress=lambda msg: print(msg, flush=True),
    )

    print('=' * 70)
    print(
        f'Run complete: {summary.recorded} recorded, '
        f'{summary.skipped_existing} skipped (already recorded), '
        f'{summary.skipped_synthetic} skipped (synthetic chart), '
        f'{summary.aborted_budget} aborted (budget), '
        f'{summary.errors} errors. '
        f'Total spend: ${summary.total_cost_usd:.4f}'
    )
    print('=' * 70)
    return 0 if summary.aborted_budget == 0 and summary.errors == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
