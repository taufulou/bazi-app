# 紫微斗數 (Zi Wei Dou Shu) — Technical Feasibility Research

## Executive Summary

**Yes, 紫微斗數 is fully deterministic and formula-based**, just like our Bazi engine. The entire chart generation process follows fixed algorithmic rules — lookup tables, modular arithmetic, and conditional placement rules. There is no randomness or subjective input in chart generation. Given the same birth data (year, month, day, hour, gender), the output chart is always identical.

Multiple open-source implementations already exist, and the most mature one (**iztro**, 3.2k+ GitHub stars) provides a proven reference for building our own engine.

---

## Comparison: Bazi vs Zi Wei Dou Shu Calculation

| Aspect | 八字 (Our Bazi Engine) | 紫微斗數 (Zi Wei Dou Shu) |
|---|---|---|
| **Input** | Birth year, month, day, hour, gender, city (for solar time) | Same: birth year, month, day, hour, gender |
| **Calendar basis** | Solar → Lunar + 立春 boundary | Solar → Lunar calendar conversion |
| **Core structure** | 4 Pillars × 2 (stem + branch) = 8 characters | 12 Palaces × ~10 stars each = 138 total stars |
| **Key derivation** | Day Master → Ten Gods → Five Elements balance | Five Element Bureau → Zi Wei star position → all other stars |
| **Time sensitivity** | 2-hour blocks (時辰) | Same 2-hour blocks, but exact hour boundary critical |
| **Deterministic?** | 100% yes | 100% yes |
| **Lookup tables needed** | ~15 tables (stems, branches, Na Yin, etc.) | ~30+ tables (star placement, brightness, transformations, etc.) |
| **Complexity** | Moderate (~3ms in our engine) | Higher (~5-15ms estimated, more stars to place) |
| **Luck periods** | 大運 (10-year), 流年, 流月 | 大限 (10-year), 小限, 流年, 流月, 流日, 流時 |

**Key takeaway**: ZWDS is more complex (more stars, more tables) but follows the same paradigm — deterministic lookup tables + arithmetic formulas. No AI or fuzzy logic needed for chart generation.

---

## The Algorithm: Step-by-Step Chart Generation

### Step 1: Calendar Conversion (定時辰)
Convert solar (Gregorian) date → lunar date with Heavenly Stems (天干) and Earthly Branches (地支).
- Same as our Bazi engine — we already have this via `cnlunar` + `ephem`.
- True Solar Time correction applies here too (our `solar_time.py` can be reused).

### Step 2: Establish Fate Palace (安命宮) and Body Palace (安身宮)
Formula (口訣): "寅起順行至生月，生月起子兩頭通，逆至生時為命宮，順至生時好安身"
- Start from 寅 (Tiger) position, count forward to birth month.
- From that palace, count backward to birth hour → **Fate Palace (命宮)**.
- From birth month position, count forward to birth hour → **Body Palace (身宮)**.
- Pure modular arithmetic on the 12 Earthly Branches.

### Step 3: Lay Out 12 Palaces (定十二宮)
From the Fate Palace, count counter-clockwise:
1. 命宮 (Fate) → 2. 兄弟 (Siblings) → 3. 夫妻 (Spouse) → 4. 子女 (Children) → 5. 財帛 (Wealth) → 6. 疾厄 (Health) → 7. 遷移 (Migration) → 8. 交友/奴僕 (Friends) → 9. 事業 (Career) → 10. 田宅 (Property) → 11. 福德 (Fortune/Happiness) → 12. 父母 (Parents)

### Step 4: Determine Heavenly Stem of Each Palace (起寅首)
Using the birth year's Heavenly Stem, calculate the Heavenly Stem of the 寅 palace via the 五虎遁月 rule (same rule we already use in `four_pillars.py`). Then distribute stems forward through all 12 palaces.

### Step 5: Determine Five Element Bureau (定五行局)
Based on the Fate Palace's Heavenly Stem + Earthly Branch → Na Yin (納音) lookup → Five Element Bureau:
- 水二局 (Water 2)
- 木三局 (Wood 3)
- 金四局 (Metal 4)
- 土五局 (Earth 5)
- 火六局 (Fire 6)

This is the same Na Yin table we already have in our `constants.py`.

### Step 6: Calculate Zi Wei Star Position (安紫微星) ⭐ Core Formula
This is the single most important calculation:
1. Let `bureau` = Five Element Bureau number (2, 3, 4, 5, or 6)
2. Let `day` = lunar birth day
3. Find `quotient` = ceiling(day / bureau)
4. Calculate `remainder` = (quotient × bureau) - day
5. If remainder is **odd**: position = quotient - remainder
6. If remainder is **even**: position = quotient + remainder
7. Starting from 寅 (index 0), count to that position → Zi Wei star location

### Step 7: Place Zi Wei Star Group (紫微星系) — 6 Stars
From Zi Wei's position, count counter-clockwise:
- 紫微 → (−1) 天機 → (skip 1) → 太陽 → (−1) 武曲 → (−1) 天同 → (skip 2) → 廉貞

Mnemonic: "紫微天機星逆行，隔一陽武天同行，天同隔二是廉貞"

### Step 8: Place Tian Fu Star Group (天府星系) — 8 Stars
Tian Fu's position is the **mirror** of Zi Wei across the 寅-申 axis.
From Tian Fu, count clockwise:
- 天府 → (+1) 太陰 → (+1) 貪狼 → (+1) 巨門 → (+1) 天相 → (+1) 天梁 → (+1) 七殺 → (skip 3) → 破軍

### Step 9: Place Auxiliary Stars (安輔佐煞化星)
All via lookup tables based on birth year stem, birth year branch, birth month, or birth hour:

| Star Category | Count | Placement Rule |
|---|---|---|
| 六吉星 (6 Auspicious) | 6 | Based on birth year branch + birth hour |
| 六煞星 (6 Malefic) | 6 | Based on birth year branch + birth hour |
| 祿存 + 天馬 | 2 | Based on birth year stem / branch |
| 四化星 (4 Transformations) | 4 | Based on birth year stem → assigns 化祿/化權/化科/化忌 to specific major stars |
| 杂耀 (Adjective Stars) | 37 | Various lookup tables |
| 神煞 (Spirit Stars) | 48 | Various lookup tables |

### Step 10: Determine Star Brightness (定星曜亮度)
Each of the 14 major stars has a brightness level depending on which palace it sits in:
- 廟 (Temple, brightest) → 旺 (Prosperous) → 得 (Gained) → 利 (Beneficial) → 平 (Neutral) → 不 (Weak) → 陷 (Fallen, weakest)

This is a pure 14×12 lookup table (14 stars × 12 palaces).

### Step 11: Calculate Luck Periods (起大限)
- **大限 (Major Limit)**: Starts at the age determined by the Five Element Bureau number, moves through palaces in order (yang male/yin female = clockwise, yin male/yang female = counter-clockwise), each lasting 10 years.
- **小限 (Minor Limit)**: Annual cycle based on birth year branch.
- **流年/流月/流日/流時**: Dynamic overlay stars based on current year/month/day/hour stems and branches.

---

## Star Count Summary

| Category | Count | Notes |
|---|---|---|
| 主星 (Major Stars) | 14 | Foundation of interpretation |
| 辅星 (Auxiliary Stars) | 14 | 6 Auspicious + 6 Malefic + 2 Helpers |
| 杂耀 (Adjective Stars) | 37 | Supplementary influences |
| 神煞 (Spirit Stars) | 48 | Special conditions |
| 四化星 (Transformations) | 4 | Dynamic modifiers |
| **Static Total** | **117** | |
| 流耀 (Flowing Stars) | 21 | For luck period overlays |
| **Grand Total** | **138** | |

---

## Existing Open-Source Implementations

### 1. iztro (JavaScript/TypeScript) — Best Reference ⭐⭐⭐
- **GitHub**: https://github.com/SylarLong/iztro
- **Stars**: 3,200+ | **Forks**: 466+
- **License**: MIT
- **Features**: All 138 stars, 12 palaces, brightness, 四化, 大限/小限/流年/流月/流日/流時, multi-language (6 languages including zh-TW), plugin system for different schools
- **Ecosystem**: react-iztro (React component), iztro-hook (React hooks)
- **Why best**: Most complete, actively maintained, well-documented, has companion documentation site (iztro.com)

### 2. iztro-py (Python) — Direct Python Port
- **PyPI**: `pip install iztro-py` (v0.3.3)
- **Features**: Pure Python port of iztro, Pydantic models, 6-language i18n
- **Dependencies**: `lunarcalendar`, `pydantic`, `python-dateutil`
- **Caveat**: Lower download count (~322/month), may lag behind JS version

### 3. DeepSeek-Oracle (Python + LLM)
- **GitHub**: https://github.com/Bald0Wang/DeepSeek-Oracle
- **Architecture**: ZWDS calculation + LLM interpretation (similar to our Bazi + AI approach)
- **Relevance**: Validates our two-layer architecture pattern for ZWDS

### 4. Fortel (Java) — 中州派
- **GitHub**: https://github.com/airicyu/Fortel
- **School**: Specifically implements 中州派 (Zhong Zhou school) rules

### 5. gasolin/zwds (Python) — Legacy
- **GitHub**: https://github.com/gasolin/zwds
- **Note**: Older implementation, uses Chinese variable names (.twpy files)

---

## Implementation Strategy for Our Platform

### Option A: Use iztro-py as dependency (Fastest)
```
pip install iztro-py
```
- Pros: Immediate, tested, maintained
- Cons: External dependency, less control, may not match our True Solar Time precision

### Option B: Port iztro logic to our FastAPI engine (Recommended) ⭐
- Use iztro's TypeScript source as reference (MIT license)
- Build a new `packages/bazi-engine/app/ziwei/` module
- Reuse our existing infrastructure:
  - `solar_time.py` — True Solar Time correction
  - `constants.py` — Na Yin tables, Stems/Branches (already have these)
  - Lunar calendar conversion (cnlunar)
- New modules needed:
  - `ziwei_calculator.py` — Main orchestrator
  - `ziwei_constants.py` — Star placement tables, brightness tables
  - `palace.py` — 12 palace layout logic
  - `star_placement.py` — All star placement algorithms
  - `ziwei_luck_periods.py` — 大限, 小限, 流年 overlay
  - `transformations.py` — 四化 logic
- Estimated: ~30 lookup tables, ~1500 lines of Python

### Option C: Call iztro via Node.js subprocess
- Keep iztro as JS dependency, call from Python via subprocess or HTTP
- Cons: Added complexity, latency, two runtimes

### Recommendation: Option B
- Full control over accuracy and True Solar Time integration
- Consistent with our Bazi engine architecture
- MIT license allows using iztro as reference
- We already have 60% of the foundation (calendar, stems, branches, Na Yin, solar time)

---

## Key Considerations

### School Differences (派別差異)
Different ZWDS schools have slightly different rules for:
- 四化 (Transformation star assignments) — the biggest difference between schools
- Star brightness levels
- Some auxiliary star placements

**Recommendation**: Start with the most common school (三合派 / iztro default), add configurable options later for other schools like 中州派 or 飛星派.

### Leap Month Handling (閏月)
Three approaches exist in the community:
1. First half → previous month, second half → next month
2. Entire leap month → current month
3. Entire leap month → next month

**Recommendation**: Implement option 1 (most common), with configuration flag.

### True Solar Time
Our existing `solar_time.py` already handles this — a significant accuracy advantage over most ZWDS calculators that ignore it.

---

## API Design (Proposed)

```
POST /ziwei/calculate
{
  "birth_date": "1990-05-15",
  "birth_time": "14:30",
  "gender": "male",
  "city": "taipei",
  "calendar_type": "solar",  // or "lunar"
  "school": "sanhe"           // optional: "sanhe", "zhongzhou", "feixing"
}

Response:
{
  "palaces": [
    {
      "name": "命宮",
      "position": "午",
      "heavenly_stem": "壬",
      "major_stars": [{"name": "紫微", "brightness": "廟", "transformation": "化權"}],
      "minor_stars": [...],
      "adjective_stars": [...],
      "major_limit": {"start_age": 23, "end_age": 32}
    },
    // ... 11 more palaces
  ],
  "five_element_bureau": "木三局",
  "body_palace": "財帛",
  "birth_data": { "lunar_year": "庚午", "lunar_month": 4, "lunar_day": 21, "hour_branch": "未" },
  "luck_periods": { "major_limits": [...], "current_year": {...} }
}
```

---

## Effort Estimate

| Component | Lines (est.) | Reusable from Bazi Engine |
|---|---|---|
| Calendar conversion | ~100 | 90% reusable (cnlunar, solar_time.py) |
| Palace layout | ~150 | 30% reusable (stems/branches) |
| Star placement (14 major) | ~200 | Na Yin table reusable |
| Star placement (auxiliary) | ~300 | New lookup tables |
| Star brightness | ~100 | New 14×12 table |
| Transformations (四化) | ~100 | New |
| Luck periods | ~200 | 40% reusable (similar concept) |
| Constants / lookup tables | ~400 | Some Na Yin, stems, branches reusable |
| Tests | ~500 | Test patterns reusable |
| **Total** | **~2,050** | **~30% reusable** |

---

## References

- [iztro GitHub](https://github.com/SylarLong/iztro) — Primary reference implementation (MIT)
- [iztro Documentation](https://iztro.com/en_US/) — Star system & algorithm docs
- [iztro-py on PyPI](https://libraries.io/pypi/iztro-py) — Python port
- [DeepSeek-Oracle](https://github.com/Bald0Wang/DeepSeek-Oracle) — ZWDS + LLM integration example
- [星林學苑 - 手工排盤](https://www.108s.tw/article/info/88) — Manual chart calculation tutorial
- [紫微斗數 Wikipedia](https://zh.wikipedia.org/zh-hant/%E7%B4%AB%E5%BE%AE%E6%96%97%E6%95%B0) — Overview
- [紫微 vs 八字 差異](https://ptzl.tw/article-info.asp?cate=16&id=188) — Comparison analysis
- [Ziwei AI Python API](https://ziweiai.com.cn/static/en/20250512ziweiai-api.html) — Commercial API reference
