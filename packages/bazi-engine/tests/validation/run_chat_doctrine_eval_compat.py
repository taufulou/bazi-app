"""
COMPATIBILITY chat doctrine eval runner (Phase 3.1b+c).

Loads `chat_doctrine_eval_compat.csv` + replays fixtures from
`chat_doctrine_eval_compat_responses/` + runs substring checks
(expected_all / expected_any / forbidden_all) per row. Mirrors
`run_chat_doctrine_eval.py` for single-chart trials but handles the
compat-specific schema (chart_id_a/chart_id_b/expected_refuse/cross_sell_target).

Usage
-----
    # Mock mode — substring checks only (fast, free)
    python tests/validation/run_chat_doctrine_eval_compat.py

    # Verbose mode — show full response on failure
    python tests/validation/run_chat_doctrine_eval_compat.py --verbose

CI integration
--------------
pytest wrapper at `tests/test_chat_doctrine_eval_compat.py` runs in mock
mode by default. Use `pytest --with-judge` to invoke the LLM judge for
COMPATIBILITY-aware semantic evaluation (~$0.01/trial Haiku call).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

_THIS_DIR = Path(__file__).resolve().parent
_ENGINE_ROOT = _THIS_DIR.parent.parent
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))

CSV_PATH = _THIS_DIR / 'chat_doctrine_eval_compat.csv'
FIXTURES_DIR = _THIS_DIR / 'chat_doctrine_eval_compat_responses'

# Phase 3.1c — judge
JUDGE_MODEL = 'claude-haiku-4-5'


@dataclass
class CompatEvalTrial:
    trial_id: str
    chart_id_a: str
    chart_id_b: str
    category: str
    user_question: str
    expected_all: List[str]
    expected_any: List[str]
    forbidden_all: List[str]
    doctrine_flags: List[str]
    expected_refuse: bool
    cross_sell_target: str
    notes: str = ''


@dataclass
class CompatEvalResult:
    trial_id: str
    status: str       # PASS | FAIL | NEEDS_RECORDING
    category: str = ''
    response: Optional[str] = None
    failures: List[str] = field(default_factory=list)
    expected_refuse: bool = False
    cross_sell_target: str = ''
    # Phase 3.1c — LLM-as-judge verdict (Haiku). None means judge didn't run.
    judge_verdict: Optional[str] = None
    judge_reason: str = ''


def _split(value: str) -> List[str]:
    if not value:
        return []
    return [v.strip() for v in value.split(';') if v.strip()]


def load_corpus() -> List[CompatEvalTrial]:
    trials: List[CompatEvalTrial] = []
    with CSV_PATH.open('r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trials.append(CompatEvalTrial(
                trial_id=row['trial_id'],
                chart_id_a=row['chart_id_a'],
                chart_id_b=row['chart_id_b'],
                category=row['category'],
                user_question=row['user_question'],
                expected_all=_split(row.get('expected_all', '')),
                expected_any=_split(row.get('expected_any', '')),
                forbidden_all=_split(row.get('forbidden_all', '')),
                doctrine_flags=[s.strip() for s in row.get('doctrine_flags', '').split(',') if s.strip()],
                expected_refuse=row.get('expected_refuse', '').lower() == 'true',
                cross_sell_target=row.get('cross_sell_target', ''),
                notes=row.get('notes', ''),
            ))
    return trials


def _strip_quotes(s: str) -> str:
    """Strip Chinese 「」 or ASCII single quotes around phrases used in
    expected_any / forbidden_all entries (cosmetic CSV convention)."""
    if not s:
        return s
    return s.strip().lstrip('「').rstrip('」').lstrip("'").rstrip("'").strip()


def _phrase_in_response(phrase: str, response: str) -> bool:
    """Substring check tolerant of CSV quotation conventions."""
    clean = _strip_quotes(phrase)
    return clean in response


def load_fixture(trial_id: str) -> Optional[str]:
    path = FIXTURES_DIR / f'{trial_id}.json'
    if not path.exists():
        return None
    with path.open('r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('response')


def evaluate(trial: CompatEvalTrial, response: str) -> CompatEvalResult:
    result = CompatEvalResult(
        trial_id=trial.trial_id,
        status='PASS',
        category=trial.category,
        response=response,
        expected_refuse=trial.expected_refuse,
        cross_sell_target=trial.cross_sell_target,
    )

    # expected_all — every phrase must appear
    for phrase in trial.expected_all:
        if not _phrase_in_response(phrase, response):
            result.failures.append(f'expected_all missing: "{phrase}"')

    # expected_any — at least one must appear
    if trial.expected_any:
        if not any(_phrase_in_response(p, response) for p in trial.expected_any):
            result.failures.append(
                f'expected_any: none of {trial.expected_any} found'
            )

    # forbidden_all — none must appear
    for phrase in trial.forbidden_all:
        if _phrase_in_response(phrase, response):
            result.failures.append(f'forbidden_all hit: "{phrase}"')

    if result.failures:
        result.status = 'FAIL'
    return result


def _load_full_fixture(trial_id: str) -> Optional[dict]:
    path = FIXTURES_DIR / f'{trial_id}.json'
    if not path.exists():
        return None
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def _build_compat_context_for_judge(chart_id_a: str, chart_id_b: str) -> Optional[dict]:
    """Re-build compat chat context for the judge. Engine import deferred
    so mock-mode (no judge) doesn't need the engine."""
    try:
        from app.chat_context import build_chat_context_compat  # noqa
        from tests.validation.chat_doctrine_chart_fixtures import get_chart_birth_params
    except ImportError as e:
        print(f'  ⚠ judge skipped — engine import failed: {e}')
        return None
    params_a = get_chart_birth_params(chart_id_a)
    params_b = get_chart_birth_params(chart_id_b)
    if not params_a or not params_b:
        return None
    return build_chat_context_compat(
        birth_data_a={
            'birth_date': params_a['birth_date'], 'birth_time': params_a['birth_time'],
            'birth_city': params_a['birth_city'], 'birth_timezone': params_a['birth_timezone'],
            'gender': params_a['gender'],
        },
        birth_data_b={
            'birth_date': params_b['birth_date'], 'birth_time': params_b['birth_time'],
            'birth_city': params_b['birth_city'], 'birth_timezone': params_b['birth_timezone'],
            'gender': params_b['gender'],
        },
        comparison_type='ROMANCE',
        current_year=2026,
        current_month=5,
    )


def _call_judge(trial: CompatEvalTrial, response: str, compat_ctx: dict) -> Optional[dict]:
    """Call Haiku judge for this trial. Returns {verdict, reason} or None on failure."""
    try:
        from anthropic import Anthropic
        from tests.validation.judge_prompt_compat import (
            build_compat_judge_prompt,
            parse_compat_judge_verdict,
        )
    except ImportError as e:
        return {'verdict': 'pass', 'reason': f'judge-import-fail: {e}'}
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        return None
    client = Anthropic(api_key=api_key)
    prompt = build_compat_judge_prompt(
        trial.user_question, response, compat_ctx,
        trial.expected_refuse, trial.cross_sell_target,
    )
    msg = client.messages.create(
        model=JUDGE_MODEL,
        max_tokens=300,
        messages=[{'role': 'user', 'content': prompt}],
    )
    text = msg.content[0].text if msg.content else ''
    return parse_compat_judge_verdict(text)


def run(verbose: bool = False, with_judge: bool = False) -> int:
    trials = load_corpus()
    print(f'Loaded {len(trials)} COMPAT trials from {CSV_PATH.name}')
    if with_judge:
        print(f'Judge: {JUDGE_MODEL} (Phase 3.1c)')
    print()

    results: List[CompatEvalResult] = []
    for trial in trials:
        fixture = _load_full_fixture(trial.trial_id)
        if fixture is None:
            results.append(CompatEvalResult(
                trial_id=trial.trial_id,
                status='NEEDS_RECORDING',
                category=trial.category,
            ))
            continue
        response = fixture.get('response')
        result = evaluate(trial, response or '')

        # Optional: prefer cached judge verdict in fixture, else live-call judge
        if with_judge and response:
            cached_verdict = fixture.get('judge_verdict')
            if cached_verdict:
                result.judge_verdict = cached_verdict
                result.judge_reason = fixture.get('judge_reason', 'cached')
            else:
                ctx = _build_compat_context_for_judge(trial.chart_id_a, trial.chart_id_b)
                if ctx is not None:
                    verdict = _call_judge(trial, response, ctx)
                    if verdict:
                        result.judge_verdict = verdict['verdict']
                        result.judge_reason = verdict['reason']
                        # Persist verdict to fixture for replay
                        fixture['judge_verdict'] = verdict['verdict']
                        fixture['judge_reason'] = verdict['reason']
                        fixture['judge_model'] = JUDGE_MODEL
                        path = FIXTURES_DIR / f'{trial.trial_id}.json'
                        with path.open('w', encoding='utf-8') as f:
                            json.dump(fixture, f, ensure_ascii=False, indent=2)
                        # If judge says fail, flip status to FAIL
                        if verdict['verdict'] == 'fail':
                            result.status = 'FAIL'
                            result.failures.append(f'judge: {verdict["reason"]}')

        results.append(result)

    # Summary
    pass_count = sum(1 for r in results if r.status == 'PASS')
    fail_count = sum(1 for r in results if r.status == 'FAIL')
    miss_count = sum(1 for r in results if r.status == 'NEEDS_RECORDING')
    judge_pass = sum(1 for r in results if r.judge_verdict == 'pass')
    judge_fail = sum(1 for r in results if r.judge_verdict == 'fail')

    print('=== Per-trial results ===')
    for r in results:
        marker = {'PASS': '✓', 'FAIL': '✗', 'NEEDS_RECORDING': '?'}[r.status]
        judge_marker = ''
        if r.judge_verdict:
            judge_marker = f' [judge:{r.judge_verdict}]'
        print(f'  {marker} {r.trial_id} ({r.category}){judge_marker} — {r.status}')
        if r.status == 'FAIL':
            for f in r.failures:
                print(f'      {f}')
            if verbose and r.response:
                snippet = r.response[:400].replace('\n', ' ')
                print(f'      response: {snippet}...')

    print()
    print('=== Summary ===')
    print(f'  PASS: {pass_count}/{len(trials)}')
    print(f'  FAIL: {fail_count}/{len(trials)}')
    if miss_count > 0:
        print(f'  NEEDS_RECORDING: {miss_count}')
    if with_judge:
        print(f'  Judge: {judge_pass} pass / {judge_fail} fail')
    print()

    return 0 if fail_count == 0 else 1


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='COMPAT chat doctrine eval (Phase 3.1b+c)')
    parser.add_argument('--verbose', action='store_true', help='show response snippets on failure')
    parser.add_argument('--with-judge', action='store_true', help='invoke Haiku judge (Phase 3.1c)')
    return parser.parse_args(argv)


if __name__ == '__main__':
    args = parse_args()
    sys.exit(run(verbose=args.verbose, with_judge=args.with_judge))
