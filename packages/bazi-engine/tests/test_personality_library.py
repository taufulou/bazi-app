"""
Tests for the polarity-aware ten god personality library — Phase 12g.0.

This module ships data + loader ONLY (no engine consumers yet). Tests verify:
  1. Schema completeness (all 10 ten gods × 3 polarities × 4 fields)
  2. Polarity reversal (favorable vs unfavorable produce non-overlapping keyword sets)
  3. Role → polarity mapping correctness
  4. Cache behaviour (lru_cache hits)
  5. Defensive errors (unknown ten god, unknown polarity)
"""

from __future__ import annotations

import pytest

from app.personality_library import (
    ROLE_TO_POLARITY,
    SUPPORTED_TEN_GODS,
    _load_data,
    get_supported_ten_gods,
    load_personality_by_role,
    load_ten_god_personality,
    role_to_polarity,
)


# --- Schema completeness ---


def test_all_ten_gods_present():
    data = _load_data()
    for tg in SUPPORTED_TEN_GODS:
        assert tg in data, f"Missing ten god: {tg}"


def test_each_ten_god_has_three_polarities():
    data = _load_data()
    for tg in SUPPORTED_TEN_GODS:
        cell = data[tg]
        for polarity in ("favorable", "unfavorable", "neutral"):
            assert polarity in cell, f"{tg} missing polarity: {polarity}"


@pytest.mark.parametrize("tg", sorted(SUPPORTED_TEN_GODS))
@pytest.mark.parametrize("polarity", ["favorable", "unfavorable", "neutral"])
def test_each_cell_has_required_fields(tg, polarity):
    cell = load_ten_god_personality(tg, polarity)
    for field in ("core_keywords", "spouse_traits", "secondary", "citation"):
        assert field in cell, f"{tg}.{polarity} missing field: {field}"


@pytest.mark.parametrize("tg", sorted(SUPPORTED_TEN_GODS))
def test_favorable_keywords_nonempty(tg):
    cell = load_ten_god_personality(tg, "favorable")
    assert len(cell["core_keywords"]) > 0, f"{tg}.favorable.core_keywords empty"
    assert len(cell["spouse_traits"]) > 0, f"{tg}.favorable.spouse_traits empty"
    assert cell["citation"], f"{tg}.favorable.citation empty"


@pytest.mark.parametrize("tg", sorted(SUPPORTED_TEN_GODS))
def test_unfavorable_keywords_nonempty(tg):
    cell = load_ten_god_personality(tg, "unfavorable")
    assert len(cell["core_keywords"]) > 0, f"{tg}.unfavorable.core_keywords empty"
    assert len(cell["spouse_traits"]) > 0, f"{tg}.unfavorable.spouse_traits empty"
    assert cell["citation"], f"{tg}.unfavorable.citation empty"


# --- Polarity reversal (favorable vs unfavorable should not overlap) ---


@pytest.mark.parametrize("tg", sorted(SUPPORTED_TEN_GODS))
def test_polarity_keywords_do_not_overlap(tg):
    """For each ten god, favorable and unfavorable core_keywords should be
    semantically opposite — verified here by simple set-disjoint check."""
    favorable = set(load_ten_god_personality(tg, "favorable")["core_keywords"])
    unfavorable = set(load_ten_god_personality(tg, "unfavorable")["core_keywords"])
    overlap = favorable & unfavorable
    assert not overlap, f"{tg}: favorable and unfavorable overlap: {overlap}"


# --- Specific anchor cases (regressions for known bugs) ---


def test_pian_cai_favorable_has_kangkai():
    """Anchor: 偏財 favorable should contain 慷慨大方 keyword cluster.
    This is the existing pre-12g engine flat-dict content."""
    cell = load_ten_god_personality("偏財", "favorable")
    keywords = set(cell["core_keywords"]) | set(cell["spouse_traits"])
    assert any("慷慨" in kw for kw in keywords), \
        f"偏財.favorable should contain 慷慨 keyword; got: {keywords}"


def test_pian_cai_unfavorable_has_man_bu_jingxin():
    """Anchor: 偏財 unfavorable must contain Seer's classic 漫不經心 trait
    (the gap that triggered Phase 12g)."""
    cell = load_ten_god_personality("偏財", "unfavorable")
    keywords = set(cell["core_keywords"]) | set(cell["spouse_traits"])
    assert any("漫不經心" in kw for kw in keywords), \
        f"偏財.unfavorable must contain 漫不經心 keyword; got: {keywords}"
    assert any("花錢" in kw or "花費" in kw or "揮霍" in kw for kw in keywords), \
        f"偏財.unfavorable must contain 花錢/揮霍 keyword; got: {keywords}"


def test_zheng_guan_favorable_has_zhengzhi():
    """Anchor: 正官 favorable must contain 正直 / 正義感 keyword
    (the 婚前性格 gap that Seer caught)."""
    cell = load_ten_god_personality("正官", "favorable")
    keywords = set(cell["core_keywords"]) | set(cell["secondary"])
    assert any("正直" in kw for kw in keywords), \
        f"正官.favorable must contain 正直 keyword; got: {keywords}"
    assert any("正義感" in kw or "正義" in kw for kw in keywords), \
        f"正官.favorable must contain 正義感 keyword; got: {keywords}"


def test_qi_sha_unfavorable_has_baozao():
    """Anchor: 七殺 unfavorable should contain 暴躁 keyword (classical doctrine)."""
    cell = load_ten_god_personality("七殺", "unfavorable")
    keywords = set(cell["core_keywords"]) | set(cell["spouse_traits"])
    assert any("暴躁" in kw for kw in keywords), \
        f"七殺.unfavorable should contain 暴躁 keyword; got: {keywords}"


# --- Role to polarity mapping ---


def test_role_to_polarity_yong():
    assert role_to_polarity("用神") == "favorable"


def test_role_to_polarity_xi():
    assert role_to_polarity("喜神") == "favorable"


def test_role_to_polarity_ji():
    assert role_to_polarity("忌神") == "unfavorable"


def test_role_to_polarity_chou():
    assert role_to_polarity("仇神") == "unfavorable"


def test_role_to_polarity_xian():
    assert role_to_polarity("閒神") == "neutral"


def test_role_to_polarity_unknown_falls_back_to_neutral():
    assert role_to_polarity("foo") == "neutral"
    assert role_to_polarity(None) == "neutral"
    assert role_to_polarity("") == "neutral"


def test_role_to_polarity_table_complete():
    """All 5 classical roles mapped."""
    expected = {"用神", "喜神", "忌神", "仇神", "閒神"}
    assert set(ROLE_TO_POLARITY.keys()) == expected


# --- Convenience wrapper ---


def test_load_personality_by_role_yong():
    cell = load_personality_by_role("正官", "用神")
    assert any("正直" in kw for kw in cell["core_keywords"])


def test_load_personality_by_role_ji():
    cell = load_personality_by_role("偏財", "忌神")
    assert any("漫不經心" in kw for kw in cell["spouse_traits"])


def test_load_personality_by_role_unknown_role_neutral():
    cell = load_personality_by_role("正官", None)
    # Should fall to neutral polarity
    assert "中性" in "".join(cell["core_keywords"]) or "象意" in "".join(cell["core_keywords"])


# --- Defensive errors ---


def test_unknown_ten_god_raises():
    with pytest.raises(ValueError, match="Unknown ten god"):
        load_ten_god_personality("foo", "favorable")


def test_unknown_polarity_raises():
    with pytest.raises(ValueError, match="Unknown polarity"):
        load_ten_god_personality("正官", "good")  # type: ignore[arg-type]


# --- Helper enumerations ---


def test_get_supported_ten_gods_returns_all_ten():
    assert len(get_supported_ten_gods()) == 10
    assert set(get_supported_ten_gods()) == SUPPORTED_TEN_GODS


# --- Cache behaviour ---


def test_load_data_cached():
    """_load_data uses lru_cache; subsequent calls return same object identity."""
    a = _load_data()
    b = _load_data()
    assert a is b, "_load_data should be cached (lru_cache)"


# --- Citation presence ---


@pytest.mark.parametrize("tg", sorted(SUPPORTED_TEN_GODS))
@pytest.mark.parametrize("polarity", ["favorable", "unfavorable"])
def test_citation_references_classical_source(tg, polarity):
    """Each favorable/unfavorable cell should cite a classical text."""
    cell = load_ten_god_personality(tg, polarity)
    citation = cell["citation"]
    classical_markers = ["子平真詮", "滴天髓", "三命通會", "淵海子平", "神峰通考"]
    assert any(marker in citation for marker in classical_markers), \
        f"{tg}.{polarity} citation lacks classical source: {citation!r}"
