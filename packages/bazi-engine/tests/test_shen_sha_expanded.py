"""
Tests for Phase 11D: Expanded Shen Sha (26 types) + Special Day Pillar Detection

Tests each new Shen Sha type individually with known input/output pairs,
plus integration tests verifying they appear in full chart calculations.
"""

import pytest
from app.constants import (
    DIWANG_BRANCHES,
    GUCHEN,
    GUASU,
    GUOYIN,
    HONGLUAN,
    JINYU,
    KUIGANG_DAYS,
    SHIE_DABAI_DAYS,
    TAIJI,
    TIANDE,
    TIANXI,
    TIANLUO_BRANCHES,
    TIANYI_DOCTOR,
    WANGSHEN,
    XUETANG,
    YINYANG_ERROR_DAYS,
    YUEDE,
    ZAISHA,
    JIESHA,
)
from app.shen_sha import (
    calculate_shen_sha_for_pillar,
    detect_special_day_pillars,
)
from app.calculator import calculate_bazi


# ============================================================
# Constants Completeness Tests
# ============================================================


class TestNewConstantsCompleteness:
    """Verify all new Shen Sha lookup tables have correct coverage."""

    def test_hongluan_all_12_branches(self):
        assert len(HONGLUAN) == 12

    def test_tianxi_all_12_branches(self):
        assert len(TIANXI) == 12

    def test_tiande_all_12_branches(self):
        assert len(TIANDE) == 12

    def test_yuede_all_12_branches(self):
        assert len(YUEDE) == 12

    def test_taiji_all_10_stems(self):
        assert len(TAIJI) == 10

    def test_guoyin_all_10_stems(self):
        assert len(GUOYIN) == 10

    def test_jinyu_all_10_stems(self):
        assert len(JINYU) == 10

    def test_tianyi_doctor_all_12_branches(self):
        assert len(TIANYI_DOCTOR) == 12

    def test_xuetang_all_10_stems(self):
        assert len(XUETANG) == 10

    def test_guchen_all_12_branches(self):
        assert len(GUCHEN) == 12

    def test_guasu_all_12_branches(self):
        assert len(GUASU) == 12

    def test_zaisha_all_12_branches(self):
        assert len(ZAISHA) == 12

    def test_jiesha_all_12_branches(self):
        assert len(JIESHA) == 12

    def test_wangshen_all_12_branches(self):
        assert len(WANGSHEN) == 12

    def test_kuigang_days_count(self):
        assert len(KUIGANG_DAYS) == 4

    def test_yinyang_error_days_count(self):
        assert len(YINYANG_ERROR_DAYS) == 12

    def test_shie_dabai_days_count(self):
        assert len(SHIE_DABAI_DAYS) == 10

    def test_tianluo_branches(self):
        assert TIANLUO_BRANCHES == {'戌', '亥'}

    def test_diwang_branches(self):
        assert DIWANG_BRANCHES == {'辰', '巳'}


# ============================================================
# Individual Shen Sha Lookup Tests
# ============================================================


class TestHongLuan:
    """紅鸞 — lookup by year branch."""

    def test_zi_year_hongluan_mao(self):
        """子年 紅鸞 = 卯."""
        assert HONGLUAN['子'] == '卯'

    def test_wu_year_hongluan_you(self):
        """午年 紅鸞 = 酉."""
        assert HONGLUAN['午'] == '酉'

    def test_hongluan_detected_in_pillar(self):
        """紅鸞 should appear when pillar branch matches year-branch lookup."""
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',
            pillar_name='hour', pillar_branch='卯', pillar_stem='丁',
        )
        assert '紅鸞' in sha


class TestTianXi:
    """天喜 — 紅鸞對沖, lookup by year branch."""

    def test_zi_year_tianxi_you(self):
        """子年 天喜 = 酉."""
        assert TIANXI['子'] == '酉'

    def test_tianxi_detected_in_pillar(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',
            pillar_name='hour', pillar_branch='酉', pillar_stem='辛',
        )
        assert '天喜' in sha


class TestTianDe:
    """天德貴人 — lookup by month branch, check pillar STEM."""

    def test_yin_month_tiande_ding(self):
        """寅月 天德 = 丁."""
        assert TIANDE['寅'] == '丁'

    def test_tiande_detected_by_stem(self):
        """天德 checks if the required stem appears in pillar."""
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 寅月 → 天德=丁
            pillar_name='hour', pillar_branch='午', pillar_stem='丁',
        )
        assert '天德貴人' in sha


class TestYueDe:
    """月德貴人 — lookup by month branch, check pillar STEM."""

    def test_yin_month_yuede_bing(self):
        """寅月 月德 = 丙."""
        assert YUEDE['寅'] == '丙'

    def test_yuede_detected_by_stem(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 寅月 → 月德=丙
            pillar_name='year', pillar_branch='午', pillar_stem='丙',
        )
        assert '月德貴人' in sha


class TestTaiJi:
    """太極貴人 — lookup by day stem, check branch."""

    def test_jia_taiji_zi_wu(self):
        """甲日 太極 = [子, 午]."""
        assert set(TAIJI['甲']) == {'子', '午'}

    def test_taiji_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='year', pillar_branch='子', pillar_stem='壬',
        )
        assert '太極貴人' in sha


class TestGuoYin:
    """國印貴人 — lookup by day stem, check branch."""

    def test_jia_guoyin_xu(self):
        """甲日 國印 = 戌."""
        assert GUOYIN['甲'] == '戌'

    def test_guoyin_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='戌', pillar_stem='甲',
        )
        assert '國印貴人' in sha


class TestJinYu:
    """金輿 — lookup by day stem, check branch."""

    def test_jia_jinyu_chen(self):
        """甲日 金輿 = 辰."""
        assert JINYU['甲'] == '辰'

    def test_jinyu_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='辰', pillar_stem='庚',
        )
        assert '金輿' in sha


class TestTianYiDoctor:
    """天醫 — lookup by month branch, check branch."""

    def test_yin_month_tianyi_chou(self):
        """寅月 天醫 = 丑."""
        assert TIANYI_DOCTOR['寅'] == '丑'

    def test_tianyi_doctor_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',  # 寅月 → 天醫=丑
            pillar_name='year', pillar_branch='丑', pillar_stem='己',
        )
        assert '天醫' in sha


class TestXueTang:
    """學堂 — lookup by day stem (長生位), check branch."""

    def test_jia_xuetang_hai(self):
        """甲日 學堂 = 亥."""
        assert XUETANG['甲'] == '亥'

    def test_xuetang_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='亥', pillar_stem='乙',
        )
        assert '學堂' in sha


class TestGuChen:
    """孤辰 — lookup by year branch, check branch."""

    def test_hai_year_guchen_yin(self):
        """亥/子/丑年 孤辰 = 寅."""
        assert GUCHEN['亥'] == '寅'
        assert GUCHEN['子'] == '寅'
        assert GUCHEN['丑'] == '寅'

    def test_guchen_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 子年 → 孤辰=寅
            pillar_name='month', pillar_branch='寅', pillar_stem='壬',
        )
        assert '孤辰' in sha


class TestGuaSu:
    """寡宿 — lookup by year branch, check branch."""

    def test_hai_year_guasu_xu(self):
        """亥/子/丑年 寡宿 = 戌."""
        assert GUASU['亥'] == '戌'
        assert GUASU['子'] == '戌'
        assert GUASU['丑'] == '戌'

    def test_guasu_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 子年 → 寡宿=戌
            pillar_name='hour', pillar_branch='戌', pillar_stem='甲',
        )
        assert '寡宿' in sha


class TestZaiSha:
    """災煞 — lookup by year/day branch, check branch."""

    def test_shen_year_zaisha_wu(self):
        """申/子/辰年 災煞 = 午."""
        assert ZAISHA['申'] == '午'
        assert ZAISHA['子'] == '午'
        assert ZAISHA['辰'] == '午'

    def test_zaisha_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 子年 → 災煞=午
            pillar_name='day', pillar_branch='午', pillar_stem='庚',
        )
        assert '災煞' in sha


class TestJieSha:
    """劫煞 — lookup by year/day branch, check branch."""

    def test_shen_year_jiesha_si(self):
        """申/子/辰年 劫煞 = 巳."""
        assert JIESHA['申'] == '巳'
        assert JIESHA['子'] == '巳'
        assert JIESHA['辰'] == '巳'

    def test_jiesha_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 子年 → 劫煞=巳
            pillar_name='day', pillar_branch='巳', pillar_stem='丁',
        )
        assert '劫煞' in sha


class TestWangShen:
    """亡神 — lookup by year/day branch, check branch."""

    def test_shen_year_wangshen_hai(self):
        """申/子/辰年 亡神 = 亥."""
        assert WANGSHEN['申'] == '亥'
        assert WANGSHEN['子'] == '亥'
        assert WANGSHEN['辰'] == '亥'

    def test_wangshen_detected(self):
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',  # 子年 → 亡神=亥
            pillar_name='hour', pillar_branch='亥', pillar_stem='乙',
        )
        assert '亡神' in sha


class TestTianLuoDiWang:
    """天羅/地網 — element-specific."""

    def test_tianluo_for_fire_dm(self):
        """火命日主 + 戌/亥 branch = 天羅."""
        # 丙 = 火日主
        sha = calculate_shen_sha_for_pillar(
            day_stem='丙', day_branch='寅',
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='戌', pillar_stem='甲',
        )
        assert '天羅' in sha

    def test_diwang_for_water_dm(self):
        """水命日主 + 辰/巳 branch = 地網."""
        # 壬 = 水日主
        sha = calculate_shen_sha_for_pillar(
            day_stem='壬', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='辰', pillar_stem='甲',
        )
        assert '地網' in sha

    def test_no_tianluo_for_non_fire(self):
        """Non-fire Day Master should NOT get 天羅."""
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',  # 甲=木
            year_branch='寅', month_branch='寅',
            pillar_name='hour', pillar_branch='戌', pillar_stem='甲',
        )
        assert '天羅' not in sha


# ============================================================
# Special Day Pillar Detection Tests
# ============================================================


class TestSpecialDayPillars:
    """Test 魁罡日, 陰陽差錯日, 十惡大敗日 detection."""

    def test_kuigang_gengchen(self):
        findings = detect_special_day_pillars('庚', '辰')
        names = [f['name'] for f in findings]
        assert '魁罡日' in names

    def test_kuigang_gengxu(self):
        findings = detect_special_day_pillars('庚', '戌')
        names = [f['name'] for f in findings]
        assert '魁罡日' in names

    def test_kuigang_renchen(self):
        findings = detect_special_day_pillars('壬', '辰')
        names = [f['name'] for f in findings]
        assert '魁罡日' in names

    def test_kuigang_wuxu(self):
        findings = detect_special_day_pillars('戊', '戌')
        names = [f['name'] for f in findings]
        assert '魁罡日' in names

    def test_non_kuigang(self):
        findings = detect_special_day_pillars('甲', '子')
        names = [f['name'] for f in findings]
        assert '魁罡日' not in names

    def test_yinyang_error_bingzi(self):
        findings = detect_special_day_pillars('丙', '子')
        names = [f['name'] for f in findings]
        assert '陰陽差錯日' in names

    def test_yinyang_error_dingchou(self):
        findings = detect_special_day_pillars('丁', '丑')
        names = [f['name'] for f in findings]
        assert '陰陽差錯日' in names

    def test_non_yinyang_error(self):
        findings = detect_special_day_pillars('甲', '子')
        names = [f['name'] for f in findings]
        assert '陰陽差錯日' not in names

    def test_shie_dabai_jiachen(self):
        findings = detect_special_day_pillars('甲', '辰')
        names = [f['name'] for f in findings]
        assert '十惡大敗日' in names

    def test_shie_dabai_jichou(self):
        """己丑 is correct per 《三命通會》 (not 乙丑)."""
        findings = detect_special_day_pillars('己', '丑')
        names = [f['name'] for f in findings]
        assert '十惡大敗日' in names

    def test_yichou_not_shie_dabai(self):
        """乙丑 should NOT be 十惡大敗日 (common error)."""
        findings = detect_special_day_pillars('乙', '丑')
        names = [f['name'] for f in findings]
        assert '十惡大敗日' not in names

    def test_multiple_specials_possible(self):
        """戊戌 is both 魁罡日 AND 十惡大敗日."""
        findings = detect_special_day_pillars('戊', '戌')
        names = [f['name'] for f in findings]
        assert '魁罡日' in names
        assert '十惡大敗日' in names

    def test_finding_has_required_fields(self):
        findings = detect_special_day_pillars('庚', '辰')
        assert len(findings) > 0
        for f in findings:
            assert 'name' in f
            assert 'meaning' in f
            assert 'effect' in f


# ============================================================
# Updated calculate_shen_sha_for_pillar API Tests
# ============================================================


class TestShenShaAPICompatibility:
    """Verify the expanded API still works with calculator.py integration."""

    def test_new_signature_with_year_month_branch(self):
        """The expanded function accepts year_branch and month_branch params."""
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='子', month_branch='寅',
            pillar_name='month', pillar_branch='寅', pillar_stem='丙',
        )
        assert isinstance(sha, list)

    def test_original_stars_still_detected(self):
        """Existing 8 Shen Sha types still work after expansion."""
        # 甲 day: 天乙貴人 = [丑, 未], 文昌 = 巳, 祿神 = 寅, 羊刃 = 卯
        sha = calculate_shen_sha_for_pillar(
            day_stem='甲', day_branch='子',
            year_branch='寅', month_branch='寅',
            pillar_name='year', pillar_branch='丑', pillar_stem='丙',
        )
        assert '天乙貴人' in sha


# ============================================================
# Integration Test — Full Chart
# ============================================================


class TestShenShaIntegration:
    """Verify expanded Shen Sha appears in full chart calculations."""

    def test_full_chart_has_shen_sha(self):
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        all_sha = r['allShenSha']
        assert isinstance(all_sha, list)
        # Should have more stars than before (was ~3-5 per chart, now 8-15+)
        assert len(all_sha) >= 3

    def test_special_day_pillars_in_result(self):
        """specialDayPillars field should exist in chart result."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert 'specialDayPillars' in r
        assert isinstance(r['specialDayPillars'], list)

    def test_pre_analysis_includes_special_day_pillars(self):
        """Pre-analysis should include specialDayPillars."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        assert 'specialDayPillars' in r['preAnalysis']

    def test_shen_sha_names_are_chinese(self):
        """All Shen Sha names should be Chinese strings."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for sha in r['allShenSha']:
            assert isinstance(sha['name'], str)
            # Should contain Chinese characters
            assert any('\u4e00' <= c <= '\u9fff' for c in sha['name'])

    def test_no_duplicate_shen_sha_per_pillar(self):
        """Each Shen Sha type should appear at most once per pillar."""
        r = calculate_bazi("1990-05-15", "14:30", "台北市", "Asia/Taipei", "male")
        for pname in ['year', 'month', 'day', 'hour']:
            sha_list = r['fourPillars'][pname]['shenSha']
            # Check for duplicates
            assert len(sha_list) == len(set(sha_list)), \
                f"Duplicate Shen Sha in {pname}: {sha_list}"
