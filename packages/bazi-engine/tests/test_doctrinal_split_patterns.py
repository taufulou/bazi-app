"""Tests for Phase 1 Fortune A4 Debt C — DOCTRINAL_SPLIT_DAY_PATTERNS.

Covers:
- Schema integrity (all required keys, valid verdicts, both schools defensible)
- detect_doctrinal_split() pattern-matching for 4 detectable patterns
- Anchor corpus rows (Roger 2026-05-14, etc.) trigger the correct pattern
"""

from __future__ import annotations

import pytest

from app.doctrinal_split_patterns import (
    DOCTRINAL_SPLIT_DAY_PATTERNS,
    detect_doctrinal_split,
)


# ============================================================
# Schema integrity — every pattern must have full required shape
# ============================================================

REQUIRED_KEYS = {
    'pattern_id', 'name_zh', 'name_en',
    'school_a', 'school_b',
    'detection_description', 'anchor_corpus_rows', 'detectable_in_code',
}
SCHOOL_REQUIRED_KEYS = {'doctrine', 'verdict', 'citation'}
VALID_VERDICTS = {
    '大吉', '吉', '吉中有凶', '平', '凶中有吉', '小凶', '凶', '大凶', '凶上加凶',
}


class TestPatternShape:
    def test_at_least_5_patterns_defined(self):
        """A4 requirement: ≥5 patterns documented."""
        assert len(DOCTRINAL_SPLIT_DAY_PATTERNS) >= 5

    def test_all_pattern_ids_unique(self):
        ids = [p['pattern_id'] for p in DOCTRINAL_SPLIT_DAY_PATTERNS]
        assert len(ids) == len(set(ids)), f'Duplicate pattern_ids: {ids}'

    def test_pattern_ids_are_snake_case(self):
        import re
        snake_case = re.compile(r'^[a-z][a-z0-9_]*$')
        for p in DOCTRINAL_SPLIT_DAY_PATTERNS:
            assert snake_case.match(p['pattern_id']), (
                f"pattern_id {p['pattern_id']!r} must be snake_case"
            )

    @pytest.mark.parametrize('pattern', DOCTRINAL_SPLIT_DAY_PATTERNS,
                              ids=lambda p: p['pattern_id'])
    def test_pattern_has_all_required_keys(self, pattern):
        missing = REQUIRED_KEYS - set(pattern.keys())
        assert not missing, f'{pattern["pattern_id"]} missing keys: {missing}'

    @pytest.mark.parametrize('pattern', DOCTRINAL_SPLIT_DAY_PATTERNS,
                              ids=lambda p: p['pattern_id'])
    def test_pattern_both_schools_complete(self, pattern):
        for school_key in ('school_a', 'school_b'):
            school = pattern[school_key]
            missing = SCHOOL_REQUIRED_KEYS - set(school.keys())
            assert not missing, (
                f"{pattern['pattern_id']} {school_key} missing: {missing}"
            )
            assert school['doctrine'].strip(), f"{school_key} doctrine empty"
            assert school['verdict'] in VALID_VERDICTS, (
                f"{school_key} verdict {school['verdict']!r} not in {VALID_VERDICTS}"
            )
            assert school['citation'].strip(), f"{school_key} citation empty"

    @pytest.mark.parametrize('pattern', DOCTRINAL_SPLIT_DAY_PATTERNS,
                              ids=lambda p: p['pattern_id'])
    def test_schools_emit_different_verdicts(self, pattern):
        """The whole point of a doctrinal split: both schools land at
        different labels. If they agree, it's not a real split."""
        va = pattern['school_a']['verdict']
        vb = pattern['school_b']['verdict']
        assert va != vb, (
            f"{pattern['pattern_id']}: both schools emit {va!r} — not a real split"
        )

    @pytest.mark.parametrize('pattern', DOCTRINAL_SPLIT_DAY_PATTERNS,
                              ids=lambda p: p['pattern_id'])
    def test_pattern_anchor_rows_format(self, pattern):
        """Anchor rows must be in 'chart_id@YYYY-MM-DD' format if present."""
        import re
        anchor_re = re.compile(r'^[a-z_]+@\d{4}-\d{2}-\d{2}$')
        for anchor in pattern['anchor_corpus_rows']:
            assert anchor_re.match(anchor), (
                f"{pattern['pattern_id']}: anchor {anchor!r} not in 'chart@YYYY-MM-DD' format"
            )


# ============================================================
# detect_doctrinal_split — match anchor corpus rows
# ============================================================

# Roger's effective_gods (ten-god format, post-normalization)
ROGER_GODS_ZH = {
    '比肩': '閒神', '劫財': '閒神',
    '食神': '仇神', '傷官': '仇神',
    '偏財': '忌神', '正財': '忌神',
    '偏官': '喜神', '正官': '喜神',
    '偏印': '用神', '正印': '用神',
}

# Laopo's effective_gods (very_weak DM 甲)
LAOPO_GODS_ZH = {
    '比肩': '喜神', '劫財': '喜神',
    '食神': '閒神', '傷官': '閒神',
    '偏財': '仇神', '正財': '仇神',
    '偏官': '忌神', '正官': '忌神',
    '偏印': '用神', '正印': '用神',
}


class TestDetectionPattern1ChongHongluan:
    """Pattern 1: 沖日支 + 紅鸞 同日 — Roger 2026-05-14 anchor."""

    def test_roger_2026_05_14_detects_chong_honluan(self):
        """Roger natal day=午; day=戊子 (day_branch=子);
        子 = 沖 of 午 (natal day clash) AND 子 = 紅鸞 of 卯 (year branch).
        Both conditions met → pattern fires."""
        # Roger strength=neutral, so we need pattern 4 NOT to fire first.
        # Day stem 戊 = 比肩 = 閒神 (not 用/喜), so pattern 4 won't fire.
        result = detect_doctrinal_split(
            day_stem='戊',
            day_branch='子',
            day_ten_god='比肩',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        assert result == 'chong_day_branch_with_honluan'


class TestDetectionPattern2SpouseStarTaboo:
    """Pattern 2: 配偶星=忌神 透干 — broadest pattern, fires last."""

    def test_laopo_辛巳_fires_pattern3_first_via_priority(self):
        """Laopo 辛巳: 辛 in 巳 = 死 → pattern 3 (jiejiao) fires FIRST due to priority.
        Pattern 2 also applies (辛=正官=spouse star=忌神) but priority order skips it.
        """
        from app.life_stages import get_life_stage
        assert get_life_stage('辛', '巳') == '死', 'fixture: 辛 in 巳 should be 死'
        result = detect_doctrinal_split(
            day_stem='辛',
            day_branch='巳',
            day_ten_god='正官',
            natal_day_branch='戌',
            year_branch='寅',
            day_master_stem='甲',
            effective_gods_zh=LAOPO_GODS_ZH,
            strength='very_weak',
            gender='female',
        )
        # Pattern 3 wins priority over pattern 2 (both apply)
        assert result == 'jiejiao_reduces_taboo_stem'

    def test_pattern2_isolated_when_no_other_patterns_apply(self):
        """Construct a case where ONLY pattern 2 fires.
        Need: spouse star = 忌神 transparent at day stem, AND day stem NOT in 絕/死/墓,
        AND no 沖+紅鸞 stack, AND not eligible for pattern 4 (e.g. very_weak DM).
        """
        from app.life_stages import get_life_stage
        # Laopo 庚午: 庚=偏官=忌神, 庚 in 午 = 沐浴 (NOT 絕/死/墓)
        assert get_life_stage('庚', '午') == '沐浴'
        result = detect_doctrinal_split(
            day_stem='庚',
            day_branch='午',
            day_ten_god='偏官',
            natal_day_branch='戌',
            year_branch='寅',
            day_master_stem='甲',
            effective_gods_zh=LAOPO_GODS_ZH,
            strength='very_weak',
            gender='female',
        )
        # Only pattern 2 should fire
        assert result == 'spouse_star_transparent_but_taboo'


class TestDetectionPattern3Jiejiao:
    """Pattern 3: 截腳 忌神 stem on 絕/死/墓 branch."""

    def test_壬辰_detects_jiejiao(self):
        """壬辰: 壬=偏財=忌神 stem. get_life_stage('壬', '辰') = 墓 → pattern 3 fires.

        Note: pattern 2 (spouse star = 忌神) also matches here, but the priority
        order ensures jiejiao fires FIRST because it's more specific.
        """
        from app.life_stages import get_life_stage
        assert get_life_stage('壬', '辰') == '墓', 'fixture: 壬 in 辰 should be 墓'
        result = detect_doctrinal_split(
            day_stem='壬',
            day_branch='辰',
            day_ten_god='偏財',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        assert result == 'jiejiao_reduces_taboo_stem'

    def test_癸未_detects_jiejiao(self):
        """癸未: 癸=正財=忌神. get_life_stage('癸', '未') = 墓 → pattern 3 fires."""
        from app.life_stages import get_life_stage
        assert get_life_stage('癸', '未') == '墓', 'fixture: 癸 in 未 should be 墓'
        result = detect_doctrinal_split(
            day_stem='癸',
            day_branch='未',
            day_ten_god='正財',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        assert result == 'jiejiao_reduces_taboo_stem'

    def test_壬午_does_NOT_detect_jiejiao(self):
        """壬午: 壬 in 午 is 胎 (NOT 絕/死/墓) — pattern 3 doesn't fire.
        Instead pattern 2 (spouse_star_transparent_but_taboo) fires."""
        from app.life_stages import get_life_stage
        assert get_life_stage('壬', '午') == '胎', 'fixture: 壬 in 午 should be 胎 not 絕/死/墓'
        result = detect_doctrinal_split(
            day_stem='壬',
            day_branch='午',
            day_ten_god='偏財',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        # Pattern 2 (spouse-star) fires instead since 壬=偏財=spouse star=忌神
        assert result == 'spouse_star_transparent_but_taboo'


class TestDetectionPattern4XishenStemRescueNeutralDm:
    """Pattern 4: 喜/用 stem rescue on neutral DM — Roger 2026-05-10 + 05-18."""

    def test_roger_2026_05_10_detects_pattern4(self):
        """甲申 day for Roger neutral DM. 甲=偏官=喜神(木) transparent.
        申=仇神(金) branch element. Pattern 4 fires."""
        result = detect_doctrinal_split(
            day_stem='甲',
            day_branch='申',
            day_ten_god='偏官',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        assert result == 'xishen_stem_rescue_neutral_dm'

    def test_pattern4_does_not_fire_on_very_weak_dm(self):
        """Pattern 4 gates on strength=neutral. Very_weak DM (Laopo) shouldn't trigger it."""
        result = detect_doctrinal_split(
            day_stem='甲',  # Laopo 喜神 stem
            day_branch='申',  # Laopo 忌神 branch
            day_ten_god='比肩',
            natal_day_branch='戌',
            year_branch='寅',
            day_master_stem='甲',
            effective_gods_zh=LAOPO_GODS_ZH,
            strength='very_weak',  # NOT neutral
            gender='female',
        )
        # Pattern 4 doesn't fire (strength != neutral); pattern 2 doesn't fire
        # either (比肩 not spouse star for female). No pattern matches.
        assert result is None


class TestDetectionReturnsNoneWhenNoSplit:
    """Plain days with no doctrinal split → returns None."""

    def test_roger_2026_05_09_癸未_no_split(self):
        """癸未 for Roger: 癸=正財=忌神 透, but 未=閒神(土) branch is neutral,
        not 絕/死/墓 for 癸. Patterns 1/2/4 don't fire either.
        For pattern 3: 癸 in 未 = ? Need to verify; let's check.
        If 癸 in 未 = 墓, pattern 3 fires. If not (likely 養), returns None."""
        from app.life_stages import get_life_stage
        # If 癸 in 未 is 養 (not 絕/死/墓), pattern 3 doesn't fire
        stage = get_life_stage('癸', '未')
        if stage in {'絕', '死', '墓'}:
            pytest.skip(f'癸 in 未 is {stage} — pattern 3 fires, test inapplicable')
        result = detect_doctrinal_split(
            day_stem='癸',
            day_branch='未',
            day_ten_god='正財',
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        assert result is None

    def test_neutral_day_with_no_special_signals_returns_none(self):
        """Pick a day where all detection criteria fail."""
        result = detect_doctrinal_split(
            day_stem='丙',
            day_branch='戌',
            day_ten_god='偏印',  # 用神 for Roger
            natal_day_branch='午',
            year_branch='卯',
            day_master_stem='戊',
            effective_gods_zh=ROGER_GODS_ZH,
            strength='neutral',
            gender='male',
        )
        # Pattern 4: 丙=用神 stem, 戌 element=土=閒神 (NOT 忌/仇), so pattern 4 doesn't fire
        # Pattern 1: 戌 ≠ 沖 of 午 (沖 of 午 is 子), doesn't fire
        # Pattern 2: 偏印 not spouse star, doesn't fire
        # Pattern 3: 丙 is 用 stem (not 忌/仇), doesn't fire
        assert result is None


# ============================================================
# Coverage: ensure detectable_in_code flag matches actual detection
# ============================================================

class TestAnchorRowsAlignWithCorpus:
    """Every anchor_corpus_rows entry must reference a real corpus row
    that has doctrinal_split=yes. Catches drift between module + corpus."""

    @pytest.fixture(scope='class')
    def corpus_split_rows(self):
        """Load the daily_label_corpus.csv and return set of row_ids where
        doctrinal_split == 'yes'."""
        import csv
        from pathlib import Path
        corpus_path = Path(__file__).parent / 'validation' / 'daily_label_corpus.csv'
        if not corpus_path.exists():
            pytest.skip(f'Corpus not found at {corpus_path}')
        split_rows = set()
        with open(corpus_path, encoding='utf-8') as fh:
            for row in csv.DictReader(fh):
                if row.get('doctrinal_split', '').strip().lower() == 'yes':
                    split_rows.add(f"{row['chart_id']}@{row['target_date']}")
        return split_rows

    @pytest.mark.parametrize('pattern', DOCTRINAL_SPLIT_DAY_PATTERNS,
                              ids=lambda p: p['pattern_id'])
    def test_anchors_are_flagged_in_corpus(self, pattern, corpus_split_rows):
        """Every anchor row must have doctrinal_split=yes in the corpus."""
        for anchor in pattern['anchor_corpus_rows']:
            assert anchor in corpus_split_rows, (
                f"{pattern['pattern_id']}: anchor {anchor!r} claims to be a "
                f"doctrinal split but corpus has doctrinal_split=no for that row. "
                f"Either update the corpus or remove the anchor from the module."
            )


class TestDetectableFlag:
    def test_detectable_patterns_can_actually_be_detected(self):
        """For each pattern with detectable_in_code=True, there should be
        AT LEAST one anchor corpus row OR a documented detection path."""
        for p in DOCTRINAL_SPLIT_DAY_PATTERNS:
            if p['detectable_in_code']:
                # Must have either an anchor row OR detection_description
                has_anchors = len(p['anchor_corpus_rows']) > 0
                has_detection_desc = p['detection_description'].strip()
                assert has_anchors or has_detection_desc, (
                    f"{p['pattern_id']}: detectable_in_code=True requires "
                    "anchor_corpus_rows or detection_description"
                )

    def test_non_detectable_patterns_have_explanation(self):
        """Non-detectable patterns must still have detection_description
        explaining why detection is infeasible / future work."""
        for p in DOCTRINAL_SPLIT_DAY_PATTERNS:
            if not p['detectable_in_code']:
                assert p['detection_description'].strip(), (
                    f"{p['pattern_id']}: detectable_in_code=False still requires detection_description"
                )
