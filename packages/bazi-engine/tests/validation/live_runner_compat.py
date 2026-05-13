"""
Live mode recorder for COMPATIBILITY chat doctrine eval (Phase 3.1b).

Records real Anthropic Sonnet 4.6 responses for the trials in
`chat_doctrine_eval_compat.csv` (17 hand-labeled COMPAT trials). Saves
each response as `chat_doctrine_eval_compat_responses/{trial_id}.json`
for the existing pytest mock-mode runner to replay.

Differs from `live_runner.py` (single-chart) in three ways:
1. Each trial references TWO charts (chart_id_a + chart_id_b)
2. Chat context is built via `build_chat_context_compat` instead of
   `build_chat_context`
3. System prompt is the COMPATIBILITY-specific assembly from
   `buildChatV1SystemPromptForType('COMPATIBILITY')` in prompts.ts —
   extracted via Node.js subprocess to use the EXACT production prompt
   (avoiding TS→Python re-port drift). Cached in-memory.

Cost
----
Per trial: ~$0.04 (system ~13.7k tokens × $3/MTok + slim ~16k chars
≈ 5.3k tokens × $3 + ~500 output × $15 = $0.057/trial). Sonnet 4.6
caches system blocks at 1h TTL — but this runner makes 17 independent
calls and does NOT use cache_control, so each is full-price.
Total expected for 17 trials: ~$0.97.
**Hard cap: $5** (5× safety buffer; override with --budget=N).

Safeguards (per Phase 1.5 follow-up B pattern)
-----------------------------------------------
1. --dry-run flag prints estimates only, no API calls
2. $5 hard abort threshold (override with --budget=N)
3. Resume-on-failure — skips trials whose fixture already exists
4. --limit=N for canary runs (e.g. --limit=3 for ~$0.18 sanity check)

Usage
-----
    # 1. Dry-run (preview, no API calls)
    python tests/validation/live_runner_compat.py --dry-run

    # 2. Canary (3 trials, ~$0.18)
    python tests/validation/live_runner_compat.py --limit=3

    # 3. Full run (17 trials, ~$1)
    python tests/validation/live_runner_compat.py

Model lock
----------
Hardcoded to `claude-sonnet-4-6` (same as live_runner.py, matches
production CLAUDE_MODEL env). DO NOT change without bumping prompt
version + re-recording fixtures.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

_THIS_DIR = Path(__file__).resolve().parent
_ENGINE_ROOT = _THIS_DIR.parent.parent
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))

from app.chat_context import build_chat_context_compat  # noqa: E402
from tests.validation.chat_doctrine_chart_fixtures import (  # noqa: E402
    get_chart_birth_params,
    is_known_chart,
)


# ============================================================
# Constants — locked to match production
# ============================================================

LIVE_RECORDING_MODEL = 'claude-sonnet-4-6'
USD_PER_MTOK_INPUT = 3.0
USD_PER_MTOK_OUTPUT = 15.0
MAX_OUTPUT_TOKENS = 800
DEFAULT_BUDGET_USD = 5.0

VALIDATION_DIR = _THIS_DIR
CSV_PATH = VALIDATION_DIR / 'chat_doctrine_eval_compat.csv'
FIXTURES_DIR = VALIDATION_DIR / 'chat_doctrine_eval_compat_responses'

# Path to apps/api compiled prompts.js for extracting the COMPAT system prompt
WORKTREE_ROOT = _ENGINE_ROOT.parent.parent
PROMPTS_JS_PATH = WORKTREE_ROOT / 'apps' / 'api' / 'dist' / 'ai' / 'prompts.js'


# ============================================================
# Types
# ============================================================


@dataclass
class CompatTrial:
    trial_id: str
    chart_id_a: str
    chart_id_b: str
    category: str
    user_question: str
    expected_refuse: bool
    cross_sell_target: str
    notes: str


@dataclass
class TrialEstimate:
    trial_id: str
    chart_pair: str
    input_tokens_est: int
    cost_usd_est: float


# ============================================================
# System prompt extraction (via Node.js subprocess)
# ============================================================


_CACHED_COMPAT_PROMPT: Optional[str] = None
_CACHED_PROMPT_VERSION: Optional[str] = None


def extract_compat_system_prompt() -> tuple[str, str]:
    """Spawn Node.js subprocess to extract the COMPATIBILITY system prompt
    from the compiled prompts.js. Cached after first call.

    Returns (system_prompt, prompt_version).
    """
    global _CACHED_COMPAT_PROMPT, _CACHED_PROMPT_VERSION
    if _CACHED_COMPAT_PROMPT is not None and _CACHED_PROMPT_VERSION is not None:
        return _CACHED_COMPAT_PROMPT, _CACHED_PROMPT_VERSION

    if not PROMPTS_JS_PATH.exists():
        raise FileNotFoundError(
            f'Compiled prompts.js not found at {PROMPTS_JS_PATH}. '
            f'Run `nest build` in apps/api first.'
        )
    # Node script — print prompt + version separated by sentinel
    node_script = f"""
const p = require('{PROMPTS_JS_PATH}');
const prompt = p.buildChatV1SystemPromptForType('COMPATIBILITY');
const version = p.CHAT_V1_PROMPT_VERSION || 'unknown';
process.stdout.write(prompt);
process.stdout.write('\\n<<<__VERSION__>>>\\n');
process.stdout.write(version);
"""
    result = subprocess.run(
        ['node', '-e', node_script],
        capture_output=True,
        text=True,
        cwd=str(WORKTREE_ROOT / 'apps' / 'api'),
    )
    if result.returncode != 0:
        raise RuntimeError(f'Node extraction failed: {result.stderr}')
    output = result.stdout
    if '<<<__VERSION__>>>' not in output:
        raise RuntimeError(f'Unexpected Node output (no version sentinel): {output[:200]}')
    prompt, version_part = output.rsplit('<<<__VERSION__>>>', 1)
    _CACHED_COMPAT_PROMPT = prompt.rstrip('\n')
    _CACHED_PROMPT_VERSION = version_part.strip()
    return _CACHED_COMPAT_PROMPT, _CACHED_PROMPT_VERSION


# ============================================================
# Chat context build (Python — direct engine call)
# ============================================================


def build_compat_context(chart_a_id: str, chart_b_id: str,
                          target_year: int = 2026, target_month: int = 5) -> Dict:
    """Build COMPAT chat context for a chart pair. Uses fixtures from
    chat_doctrine_chart_fixtures.py (real births only; synthetic charts
    skipped by the caller via is_known_chart check)."""
    params_a = get_chart_birth_params(chart_a_id)
    params_b = get_chart_birth_params(chart_b_id)
    if params_a is None or params_b is None:
        raise ValueError(
            f'Chart pair {chart_a_id} × {chart_b_id} includes a synthetic '
            f'fixture — direct birth-param build not supported. '
            f'Use real-birth fixtures only for live recording.'
        )

    return build_chat_context_compat(
        birth_data_a={
            'birth_date': params_a['birth_date'],
            'birth_time': params_a['birth_time'],
            'birth_city': params_a['birth_city'],
            'birth_timezone': params_a['birth_timezone'],
            'gender': params_a['gender'],
        },
        birth_data_b={
            'birth_date': params_b['birth_date'],
            'birth_time': params_b['birth_time'],
            'birth_city': params_b['birth_city'],
            'birth_timezone': params_b['birth_timezone'],
            'gender': params_b['gender'],
        },
        comparison_type='ROMANCE',
        current_year=target_year,
        current_month=target_month,
    )


def extract_compat_pivot_hint(chat_context: Dict) -> Optional[str]:
    """Mirror chat-context.service.ts::extractCompatPivotHint."""
    score = chat_context.get('adjustedScore')
    label = chat_context.get('verbalLabel')
    if isinstance(score, (int, float)) and isinstance(label, str):
        return f'合盤總分 {score}分（{label}）'
    return None


def build_full_system_prompt(chat_context: Dict) -> str:
    """Assemble full system prompt: COMPAT prompt header + doctrine
    injectors + slim context JSON. Mirrors NestJS chat-prompt-builder.ts."""
    compat_prompt, _ = extract_compat_system_prompt()

    # Substitute {crossSellPivotHint} placeholder per chat-context.service.ts logic
    pivot_hint = extract_compat_pivot_hint(chat_context)
    if pivot_hint:
        compat_prompt = compat_prompt.replace('{crossSellPivotHint}', pivot_hint)
    else:
        # Null fallback — strip the entire pivot-back clause per round-3 NEW#10
        import re
        compat_prompt = re.sub(
            r'根據您[^，]*，\{crossSellPivotHint\}。[^？]+？',
            '',
            compat_prompt,
        )

    sections: List[str] = [compat_prompt]

    # Doctrine injectors from BOTH parties (chart_prompt-builder.ts:236+)
    chart_a = chat_context.get('chartA', {})
    chart_b = chat_context.get('chartB', {})
    injectors_a = chart_a.get('doctrineInjectors', {}) or {}
    injectors_b = chart_b.get('doctrineInjectors', {}) or {}
    injector_blocks = []
    for key, val in injectors_a.items():
        if val:
            injector_blocks.append(f'【A {key}】\n{val}')
    for key, val in injectors_b.items():
        if val:
            injector_blocks.append(f'【B {key}】\n{val}')
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


def estimate_input_tokens(text: str) -> int:
    return max(1, len(text) // 3)


def estimate_cost_usd(input_tokens: int, max_output_tokens: int = MAX_OUTPUT_TOKENS) -> float:
    return (input_tokens * USD_PER_MTOK_INPUT + max_output_tokens * USD_PER_MTOK_OUTPUT) / 1_000_000


def actual_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (input_tokens * USD_PER_MTOK_INPUT + output_tokens * USD_PER_MTOK_OUTPUT) / 1_000_000


# ============================================================
# Trial loading
# ============================================================


def load_trials(csv_path: Path = CSV_PATH) -> List[CompatTrial]:
    trials = []
    with open(csv_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trials.append(CompatTrial(
                trial_id=row['trial_id'],
                chart_id_a=row['chart_id_a'],
                chart_id_b=row['chart_id_b'],
                category=row['category'],
                user_question=row['user_question'],
                expected_refuse=row.get('expected_refuse', '').lower() == 'true',
                cross_sell_target=row.get('cross_sell_target', ''),
                notes=row.get('notes', ''),
            ))
    return trials


# ============================================================
# Anthropic call
# ============================================================


def call_anthropic(system_prompt: str, user_message: str) -> Dict:
    """Call Anthropic Sonnet 4.6 with the assembled prompt. Returns
    {response_text, input_tokens, output_tokens}."""
    try:
        from anthropic import Anthropic
    except ImportError:
        raise RuntimeError(
            'anthropic SDK not installed. pip install anthropic'
        )
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError('ANTHROPIC_API_KEY not set in env')
    client = Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=LIVE_RECORDING_MODEL,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system_prompt,
        messages=[{'role': 'user', 'content': user_message}],
    )
    return {
        'response_text': msg.content[0].text if msg.content else '',
        'input_tokens': msg.usage.input_tokens,
        'output_tokens': msg.usage.output_tokens,
    }


# ============================================================
# Fixture I/O
# ============================================================


def write_fixture(trial: CompatTrial, response_text: str,
                  input_tokens: int, output_tokens: int,
                  prompt_version: str) -> None:
    FIXTURES_DIR.mkdir(exist_ok=True)
    fixture = {
        'trial_id': trial.trial_id,
        'chart_id_a': trial.chart_id_a,
        'chart_id_b': trial.chart_id_b,
        'user_question': trial.user_question,
        'response': response_text,
        'model': LIVE_RECORDING_MODEL,
        'recorded_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'usage': {
            'input_tokens': input_tokens,
            'output_tokens': output_tokens,
            'cost_usd': actual_cost_usd(input_tokens, output_tokens),
        },
        'prompt_version': prompt_version,
        'category': trial.category,
        'expected_refuse': trial.expected_refuse,
        'cross_sell_target': trial.cross_sell_target,
    }
    fixture_path = FIXTURES_DIR / f'{trial.trial_id}.json'
    with open(fixture_path, 'w', encoding='utf-8') as f:
        json.dump(fixture, f, ensure_ascii=False, indent=2)


def fixture_exists(trial: CompatTrial) -> bool:
    return (FIXTURES_DIR / f'{trial.trial_id}.json').exists()


# ============================================================
# Main runner
# ============================================================


def run(args: argparse.Namespace) -> int:
    print(f'=== COMPAT live recorder (Phase 3.1b) ===')
    print(f'Model: {LIVE_RECORDING_MODEL}')
    print(f'Budget cap: ${args.budget:.2f}')
    print()

    # Extract production COMPAT prompt
    print('Extracting COMPATIBILITY system prompt from prompts.js...')
    compat_prompt, prompt_version = extract_compat_system_prompt()
    print(f'  ✓ Prompt loaded ({len(compat_prompt)} chars, version={prompt_version})')
    print()

    trials = load_trials()
    print(f'Loaded {len(trials)} trials from {CSV_PATH.name}')

    # Skip trials with synthetic charts (real births only for live recording)
    runnable = []
    for t in trials:
        if not is_known_chart(t.chart_id_a) or not is_known_chart(t.chart_id_b):
            print(f'  ⚠ SKIP {t.trial_id}: unknown chart {t.chart_id_a} × {t.chart_id_b}')
            continue
        params_a = get_chart_birth_params(t.chart_id_a)
        params_b = get_chart_birth_params(t.chart_id_b)
        if params_a is None or params_b is None:
            print(f'  ⚠ SKIP {t.trial_id}: synthetic chart in pair {t.chart_id_a} × {t.chart_id_b}')
            continue
        runnable.append(t)
    print(f'  → {len(runnable)} trials runnable (synthetic-pair skips above)')
    print()

    if args.limit:
        runnable = runnable[:args.limit]
        print(f'--limit={args.limit} applied → {len(runnable)} trials this run')
        print()

    # Dry-run cost preview
    if args.dry_run:
        print('=== DRY-RUN: cost estimates ===')
        total_est = 0.0
        for t in runnable:
            try:
                ctx = build_compat_context(t.chart_id_a, t.chart_id_b)
                full_prompt = build_full_system_prompt(ctx)
                input_text = full_prompt + t.user_question
                tokens = estimate_input_tokens(input_text)
                cost = estimate_cost_usd(tokens)
                total_est += cost
                print(f'  {t.trial_id}: {t.chart_id_a}×{t.chart_id_b} ~{tokens} tokens ${cost:.4f}')
            except Exception as e:
                print(f'  {t.trial_id}: ERROR — {e}')
        print(f'TOTAL EST: ${total_est:.4f} ({len(runnable)} trials)')
        return 0

    # Live recording with safeguards
    accumulated_cost = 0.0
    successes = 0
    skips = 0
    for trial in runnable:
        if fixture_exists(trial):
            print(f'  ⏩ SKIP {trial.trial_id}: fixture exists (resume-on-failure)')
            skips += 1
            continue

        # Build context + prompt
        try:
            ctx = build_compat_context(trial.chart_id_a, trial.chart_id_b)
            full_prompt = build_full_system_prompt(ctx)
        except Exception as e:
            print(f'  ✗ {trial.trial_id}: context build failed — {e}')
            continue

        # Pre-call budget check
        est_tokens = estimate_input_tokens(full_prompt + trial.user_question)
        est_cost = estimate_cost_usd(est_tokens)
        if accumulated_cost + est_cost > args.budget:
            print(f'  🛑 ABORT: would exceed ${args.budget:.2f} cap '
                  f'(current ${accumulated_cost:.4f} + next ${est_cost:.4f})')
            break

        # Make the call
        try:
            print(f'  ▶ {trial.trial_id}: calling Anthropic ({est_tokens} tokens estimate)...')
            result = call_anthropic(full_prompt, trial.user_question)
            cost = actual_cost_usd(result['input_tokens'], result['output_tokens'])
            accumulated_cost += cost
            write_fixture(
                trial,
                result['response_text'],
                result['input_tokens'],
                result['output_tokens'],
                prompt_version,
            )
            successes += 1
            print(f'    ✓ saved ({result["input_tokens"]} in / {result["output_tokens"]} out, ${cost:.4f}; cumul ${accumulated_cost:.4f})')
        except Exception as e:
            print(f'  ✗ {trial.trial_id}: API call failed — {e}')

    print()
    print(f'=== SUMMARY ===')
    print(f'  Successes: {successes}')
    print(f'  Skipped (fixture exists): {skips}')
    print(f'  Total spent: ${accumulated_cost:.4f}')
    return 0 if successes > 0 or skips > 0 else 1


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='COMPAT chat live recorder (Phase 3.1b)')
    parser.add_argument('--dry-run', action='store_true', help='preview only')
    parser.add_argument('--budget', type=float, default=DEFAULT_BUDGET_USD)
    parser.add_argument('--limit', type=int, default=0, help='cap trial count')
    return parser.parse_args(argv)


if __name__ == '__main__':
    sys.exit(run(parse_args()))
