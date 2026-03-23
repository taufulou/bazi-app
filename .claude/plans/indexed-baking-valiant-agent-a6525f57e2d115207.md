# 八字流年運勢 (Annual Fortune Reading) — Comprehensive Research Report

## Executive Summary

This document presents intensive research findings across 12 areas of professional Bazi annual fortune analysis. The research validates most of our planned implementation while revealing several gaps and corrections needed. The findings are organized by research area with concrete recommendations for implementation.

---

## Research Area 1: 流年分析的完整方法論 (Complete Flow Year Methodology)

### Professional Methodology

Professional Bazi masters follow a **three-layer hierarchy** for annual analysis:

1. **命局 (Natal Chart)** = 民 (citizen/base) — the static foundation
2. **大運 (Luck Period)** = 臣 (minister) — the decade-level dynamic
3. **流年 (Flow Year)** = 君 (emperor) — the annual dynamic with highest authority

**Key principle**: 「流年為君，大運為臣，命局為民」 — Flow year has supreme authority. It can act upon both 大運 and 命局, while 命局 cannot actively resist flow year influence.

### Flow Year Stem vs Branch Division of Labor

This is a CRITICAL finding that impacts our implementation:

| Component | Term | Role | Governs |
|-----------|------|------|---------|
| 流年天干 | 歲君 (Year Lord) | External manifestation | **What happens** — the visible events, external circumstances, what others can see |
| 流年地支 | 太歲 (Grand Duke) | Internal causation + power | **Why it happens + severity** — the root cause, hidden influences, actual power level, determines true auspiciousness |

**Professional consensus**: 流年地支 (太歲) is MORE important than 流年天干 (歲君) for determining actual fortune. The stem shows the surface events; the branch determines whether they are truly good or bad and why.

**Temporal division (DISPUTED)**: Some folk practitioners claim 天干 governs first half of year and 地支 governs second half. Professional masters largely REJECT this simplistic split, saying both operate simultaneously throughout the year, just in different domains (external vs internal).

### Our Implementation Status

**COVERED**: We have flow year stem/branch derivation from 60甲子 cycle.

**GAP**: We need to implement the stem=external / branch=internal analytical framework. Currently we treat stem and branch somewhat equally. We should:
1. Derive ten god from flow year STEM → day master for "external event type"
2. Analyze flow year BRANCH interactions with natal branches for "actual fortune level"
3. Check if stem and branch are harmonious (干支通氣 = stem generates branch, good synergy) or conflicting (蓋頭/截腳 = stem clashes branch, energy loss)

### 干支通氣 / 蓋頭 / 截腳 (NEW concept to implement)

| Pattern | Condition | Meaning |
|---------|-----------|---------|
| 干支通氣 | Stem and branch of flow year support each other (e.g., stem generates branch element) | External opportunity has solid internal support — good year |
| 蓋頭 | Stem restrains/controls branch | External pressure suppresses internal potential — opportunities blocked |
| 截腳 | Branch restrains/controls stem | Internal foundation undermines external appearance — hidden sabotage |

**Recommendation**: Add `assess_flow_year_stem_branch_harmony()` function to determine which pattern the flow year exhibits.

---

## Research Area 2: 流年與命局的作用方式 (How Flow Year Interacts with Natal Chart)

### Professional Methodology

**Two interaction pathways** (both operate simultaneously):

1. **Direct path**: 流年 → 命局 (flow year directly acts on natal chart)
2. **Indirect path**: 流年 → 大運 → 命局 (flow year acts on luck period, result then acts on natal chart)

**Interaction rules**:
- 天干 acts on 天干: Flow year stem vs natal chart stems (and luck period stem)
- 地支 acts on 地支: Flow year branch vs natal chart branches (and luck period branch)
- Cross-level interaction (天干 → 地支) is debated. Conservative approach: keep same-level interactions primary, cross-level secondary

**Dynamic vs Static principle**:
- 命局 = static (always present)
- 大運 = dynamic relative to 命局, but static relative to 流年
- 流年 = the active agent that triggers events

### Per-Pillar Interaction (宮位 system)

This is CONFIRMED as standard professional practice:

| Pillar | 宮位 (Palace) | Represents | Age Range |
|--------|-------------|------------|-----------|
| 年柱 | 祖上宮 / 長輩宮 | Grandparents, parents (paternal), early childhood | 1-16 |
| 月柱 | 父母宮 / 事業宮 | Parents, siblings, career foundation | 17-32 |
| 日柱 | 夫妻宮 / 自身宮 | Self, spouse, marriage | 33-48 |
| 時柱 | 子女宮 / 晚年宮 | Children, subordinates, late life | 49+ |

**When flow year interacts with a specific pillar** (via clash, combination, punishment, etc.), the event manifests in that pillar's domain.

### Near vs Far Interaction (近作用 vs 遠作用)

**DISPUTED concept**. Some schools (新派) say adjacent pillars interact more strongly. Most traditional (古法) practitioners say **all four pillars are affected simultaneously** by the flow year, with the specific interaction type (沖/合/刑/害) determining severity, not positional proximity.

**Recommendation**: Implement per-pillar interaction detection with all four pillars equally, noting which palace is affected. Do NOT implement proximity-based weighting — it's not mainstream.

### Our Implementation Status

**COVERED**: Basic flow year vs natal chart interaction exists.
**GAP**: Per-pillar palace attribution (年柱=長輩宮 etc.) needs to be explicitly implemented to produce interpretations like "流年沖月柱，事業宮受沖，工作有變動".

---

## Research Area 3: 流年十神的意義 (Meaning of Flow Year Ten Gods)

### Professional Methodology

The ten god of the flow year stem (relative to day master) determines the **theme** of the year. Body strength (身強/身弱) FUNDAMENTALLY changes interpretation:

#### Flow Year Ten God Meanings

| Ten God | 身強 (Strong DM) | 身弱 (Weak DM) |
|---------|-------------------|-----------------|
| **正官** | Career advancement, promotion, recognition, authority increases | Pressure, stress, legal issues, authority figures oppress you |
| **七殺** | Bold career moves succeed, competitive victory | Overwhelming pressure, accidents, health crisis, lawsuits |
| **正印** | Academic achievement, certifications, mentorship helps | Over-reliance on others, laziness, stagnation (already too much support) |
| **偏印** | Creative breakthroughs, unconventional income | Isolation, loneliness, loss of food god (奪食), mental health issues |
| **正財** | Stable income increase, marriage (for males), property | Financial drain, spouse issues, overwork for meager returns |
| **偏財** | Windfall, investment returns, father's fortune | Gambling losses, risky investments fail, father's health issues |
| **食神** | Creativity, enjoyment, good appetite, children (for females) | Energy drain, overthinking, weight issues, excessive spending |
| **傷官** | Innovation, talent recognition, side business success | Rebelliousness, conflicts with authority, career disruption |
| **比肩** | Peer support, collaboration, networking | Competition, resource sharing forced, financial pressure from friends |
| **劫財** | Active social life, bold moves succeed | Betrayal by friends/partners, financial losses, disputes |

#### Body Strength Interaction Framework

- **身強喜**: 官殺 (control), 食傷 (drain), 財星 (consume) → these ten gods appearing as flow year stem = FAVORABLE
- **身強忌**: 印星 (more support), 比劫 (more competition) → these = UNFAVORABLE
- **身弱喜**: 印星 (support), 比劫 (help) → these = FAVORABLE
- **身弱忌**: 官殺 (more pressure), 食傷 (more drain), 財星 (more burden) → these = UNFAVORABLE

### 用神/忌神 Framework (MORE PRECISE than body strength alone)

The above body-strength framework is a simplified version. The MORE ACCURATE method is:

1. Determine flow year stem's ten god
2. Check if this ten god is the chart's 用神, 喜神, 閒神, 仇神, or 忌神
3. 用神 appearance → very favorable
4. 喜神 appearance → favorable
5. 閒神 → neutral
6. 仇神 → somewhat unfavorable
7. 忌神 appearance → very unfavorable

**Recommendation**: We already have the 用神/忌神 system. Map flow year ten god → role in chart for primary assessment.

### Our Implementation Status

**COVERED**: Ten god derivation, 用神/忌神 system both exist.
**GAP**: Need a mapping function: `get_flow_year_ten_god_role()` that returns the ten god of the flow year stem AND its role (用/喜/閒/仇/忌) in the chart, plus a human-readable interpretation template.

---

## Research Area 4: 流月分析方法 (Monthly Analysis Method)

### Professional Methodology

Monthly analysis follows the same principles as annual, but with the flow year as the **background context**:

1. **Derive flow month stem + branch** (already implemented in our engine)
2. **Determine flow month's ten god** (stem relative to day master)
3. **Check if flow month ten god is 用神/忌神**
4. **Combine with flow year assessment**:
   - 月吉 + 年吉 = 大吉
   - 月吉 + 年凶 = 吉中有凶
   - 月凶 + 年凶 = 凶上加凶
   - 月凶 + 年吉 = 凶中有吉
5. **Check flow month branch interactions with natal chart branches** (六沖/六合/三合/刑/害/破)
6. **Check flow month branch vs flow year branch interaction** (this is IMPORTANT — does the month reinforce or clash with the year?)

### Monthly vs Daily Pillar Interaction

Professional masters confirm: **flow month vs 日柱 (day pillar)** interaction is particularly significant for monthly assessment, because the day pillar represents the self. If flow month 天克地冲 with day pillar, that month carries personal misfortune risk.

### Four-Aspect Monthly Assessment

For comprehensive monthly readings, masters assess four aspects:
1. **事業** (Career): flow month ten god's career implications
2. **財運** (Finance): flow month vs natal 財星 interactions
3. **感情** (Romance): flow month vs 日支 (spouse palace) interactions
4. **健康** (Health): flow month element vs natal weak elements

### Key Design Decision Validation

**The user's decision to EXCLUDE 大運 from monthly auspiciousness is partially supported**: Professional methodology says 流月 assessment primarily looks at flow month vs natal chart + flow year context. 大運 sets the decade-level backdrop but doesn't dominate individual monthly assessment. However, some masters DO factor 大運 into monthly readings as background influence. The user's approach of mentioning 大運 separately with 「流年為君，大運為臣」 is a reasonable interpretation.

### Our Implementation Status

**COVERED**: Flow month derivation exists.
**GAP**: Need per-month interaction analysis with all four natal pillars + flow year. The four-aspect framework (career/finance/romance/health) for each month is a new feature to implement.

---

## Research Area 5: 太歲分析 — 犯太歲的正確理解

### Professional Methodology

**Critical finding**: In professional Bazi, 太歲 = 流年地支. They are the same thing. "犯太歲" is when natal chart branches interact unfavorably with the flow year branch.

### Five Types of 犯太歲

| Type | Interaction | Severity |
|------|------------|----------|
| **值太歲** (Value) | Flow year branch = natal branch (same animal) | Moderate — change, instability, NOT automatically bad |
| **沖太歲** (Clash) | Flow year branch clashes natal branch | **Most severe** — major disruption, upheaval |
| **刑太歲** (Punishment) | Flow year branch punishes natal branch | Severe — legal issues, injuries, hidden troubles |
| **害太歲** (Harm) | Flow year branch harms natal branch | Moderate — backstabbing, betrayal, minor health issues |
| **破太歲** (Break) | Flow year branch breaks natal branch | **Mildest** — minor setbacks, relationship cracks |

### Which Branches to Check?

**IMPORTANT FINDING**: Professional Bazi checks ALL FOUR pillar branches against the flow year branch, not just the year branch (生肖):

| Pillar Branch | If it 犯太歲 | Affected Area |
|---------------|-------------|---------------|
| 年支 (Year) | Most publicized (folk belief) | Elders, parents, external social fortune |
| 月支 (Month) | Career/business disruption | Work, career, parents |
| **日支 (Day)** | **Most personally significant** | Self, spouse, marriage — most impactful |
| 時支 (Hour) | Children, late life | Children's issues, subordinate problems |

### Is 犯太歲 Automatically Bad?

**NO** — this is a critical professional insight:

- If the natal branch being clashed/punished is an 忌神, then 犯太歲 can actually be BENEFICIAL (removing a harmful element)
- If the natal branch is a 用神, then 犯太歲 is genuinely harmful
- 值太歲 (same branch) can be positive if the branch is a 用神 — it strengthens it (伏吟 doubles its energy)
- The folk belief that 犯太歲 is automatically terrible is an OVERSIMPLIFICATION

**Recommendation**: Implement nuanced 犯太歲 analysis that considers the ten god role of the affected branch, not just the interaction type.

### Our Implementation Status

**PLANNED**: We planned the five-type analysis.
**CORRECTION NEEDED**: Must check all four pillar branches, not just year branch. Must integrate 用神/忌神 role of the affected branch to determine actual fortune impact.

---

## Research Area 6: 夫妻宮 + 感情分析 (Spouse Palace + Romance Analysis)

### Professional Methodology

Romance analysis in flow year has TWO tracks:

#### Track 1: 夫妻宮 (Spouse Palace = 日支)

Check flow year branch interactions with 日支:

| Interaction | Meaning |
|-------------|---------|
| 六合 | Romance opportunity, marriage signal, harmony with spouse |
| 三合 | Broader social connection leading to romance |
| 六沖 | Marriage crisis, separation signal, major spouse conflict |
| 刑 | Hidden marital problems surface, legal issues in marriage |
| 害 | Betrayal, backstabbing in relationship |
| 伏吟 (same branch) | Repetitive patterns, rekindling of old relationships |

#### Track 2: 夫妻星 (Spouse Star)

- **Male**: 正財 = wife star, 偏財 = mistress/girlfriend star
- **Female**: 正官 = husband star, 七殺 = boyfriend/lover star

When the flow year stem produces the spouse star (relative to day master), romance is activated for that year.

#### Track 3: 桃花星 (Peach Blossom Star)

**Calculation method CONFIRMED**:
- Based on **both year branch AND day branch** (check both, day branch is primary for personal romance)
- Formula: 申子辰見酉, 寅午戌見卯, 亥卯未見子, 巳酉丑見午
- When flow year branch = one's peach blossom star → romance year

#### Track 4: 紅鸞 / 天喜

**CONFIRMED as Bazi concept** (not just 紫微斗數):

**紅鸞 calculation**: From year branch, 子年起卯, then reverse (逆數):
| Year Branch | 紅鸞 | 天喜 (opposite) |
|-------------|-------|-----------------|
| 子 | 卯 | 酉 |
| 丑 | 寅 | 申 |
| 寅 | 丑 | 未 |
| 卯 | 子 | 午 |
| 辰 | 亥 | 巳 |
| 巳 | 戌 | 辰 |
| 午 | 酉 | 卯 |
| 未 | 申 | 寅 |
| 申 | 未 | 丑 |
| 酉 | 午 | 子 |
| 戌 | 巳 | 亥 |
| 亥 | 辰 | 戌 |

When flow year branch = one's 紅鸞 or 天喜 → romance/marriage/joyful event year.

#### Track 5: 天地鸳鸯合 (Heavenly-Earthly Mandarin Duck Combination)

When flow year pillar forms 天合地合 with day pillar (stem combines + branch combines), this is a **strong marriage signal**. Example: Day pillar 甲子, flow year 己丑 (甲己合 + 子丑合) = marriage year candidate.

### Our Implementation Status

**PLANNED**: Tracks 1-2 were planned. Track 3 (桃花) partially exists.
**NEW**: Track 4 (紅鸞/天喜) needs implementation — it IS a Bazi concept, confirmed. Track 5 (天地鸳鸯合) is a powerful marriage signal to add.

---

## Research Area 7: 流年財運分析 (Annual Wealth Analysis)

### Professional Methodology

#### Wealth Assessment Framework

1. **Flow year ten god = 正財**: Stable income, salary increase, property acquisition (身強 = favorable; 身弱 = burden)
2. **Flow year ten god = 偏財**: Windfall, investment, speculative gains (身強 = favorable; 身弱 = gambling losses)
3. **食傷生財 chain**: When flow year activates 食神/傷官 → 財星 chain, wealth comes through creativity/skills
4. **比劫奪財**: When flow year brings 比肩/劫財 AND natal chart has exposed 財星, wealth is stolen/shared — financial loss signal
5. **官印相生 → 財**: Career promotion leading to income increase

#### 財庫 (Wealth Treasury) Analysis — CONFIRMED as important

Each day master has a specific 財庫 branch:

| Day Master Element | Wealth Element | 財庫 Branch |
|-------------------|---------------|-------------|
| 木 (Wood) | 土 (Earth) | **戌** |
| 火 (Fire) | 金 (Metal) | **丑** |
| 土 (Earth) | 水 (Water) | **辰** |
| 金 (Metal) | 木 (Wood) | **未** |
| 水 (Water) | 火 (Fire) | **戌** |

**財庫逢沖開庫**: When the flow year branch clashes the 財庫 branch, the treasury "opens" — potential for significant wealth:
- 戌 treasury → 辰 year opens it (辰戌沖)
- 丑 treasury → 未 year opens it (丑未沖)
- 辰 treasury → 戌 year opens it (辰戌沖)
- 未 treasury → 丑 year opens it (丑未沖)

**Conditions for actual wealth**: DM must be strong AND 財星 must be favorable (用神). If DM is weak, 財庫逢沖 = money comes and goes, or brings financial trouble.

### Our Implementation Status

**PARTIALLY COVERED**: 財庫逢沖 was implemented in career reading.
**GAP**: Need to adapt for annual reading context. Need the full wealth assessment framework combining all five signals.

---

## Research Area 8: 流年健康分析 (Annual Health Analysis)

### Professional Methodology

#### Five Element → Organ Mapping (Gold Standard)

**天干 detailed mapping**:

| Stem | Organ (陰) | Organ (陽) | Body Part |
|------|-----------|-----------|-----------|
| 甲 | 肝 (Liver) | 膽 (Gallbladder) | Head, hair |
| 乙 | 肝 (Liver) | | Shoulders, neck |
| 丙 | 小腸 (Sm. Intestine) | 心 (Heart) | Forehead, eyes |
| 丁 | 心 (Heart) | | Teeth, tongue |
| 戊 | 胃 (Stomach) | | Nose, face |
| 己 | 脾 (Spleen) | | Nose, face |
| 庚 | 大腸 (Lg. Intestine) | 肺 (Lungs) | Tendons, navel |
| 辛 | 肺 (Lungs) | | Chest, ribs |
| 壬 | 膀胱 (Bladder) | 腎 (Kidneys) | Shins, calves |
| 癸 | 腎 (Kidneys) | | Feet |

**Five Element → Organ simplified mapping** (confirmed):
| Element | Yin Organ | Yang Organ | Sense |
|---------|-----------|-----------|-------|
| 木 Wood | 肝 Liver | 膽 Gallbladder | Eyes |
| 火 Fire | 心 Heart | 小腸 Sm. Intestine | Tongue |
| 土 Earth | 脾 Spleen | 胃 Stomach | Mouth |
| 金 Metal | 肺 Lungs | 大腸 Lg. Intestine | Nose |
| 水 Water | 腎 Kidneys | 膀胱 Bladder | Ears |

#### Health Risk Assessment in Flow Year

1. **忌神 element in flow year** → the organ mapped to that element is at risk
2. **Too much of one element (太過)** → that element's organs become hyperactive/inflamed (實證)
3. **Too little of one element (不及)** → that element's organs become weak/deficient (虛證)
4. **Element being clashed** → sudden acute issues in that organ system
5. **克泄太過** → acute illness; **生扶太過** → chronic illness

#### 十二長生 Position for Health

The day master's 十二長生 position in the flow year branch provides health vitality indicator:

| Position | Health Implication |
|----------|-------------------|
| 長生 | New energy, recovery, vitality increasing |
| 沐浴 | Unstable, susceptible to indulgence-related issues |
| 冠帶 | Strengthening, building resilience |
| 臨官 | Strong vitality, peak resistance |
| 帝旺 | Maximum energy but risk of excess/burnout |
| 衰 | Declining energy, need more rest |
| 病 | Literally "illness" position — heightened disease risk |
| 死 | Very low vitality, serious health concerns |
| 墓 | Energy stored/dormant, chronic conditions |
| 絕 | Extremely low vitality, critical health risk |
| 胎 | New cycle beginning, conception/regeneration |
| 養 | Nurturing phase, gradual recovery |

### Our Implementation Status

**PLANNED**: Basic five element → organ mapping was planned.
**GAP**: Need to add the 十二長生 health vitality indicator. Need the dual assessment (太過/不及). Need specific stem → organ detail mapping.

---

## Research Area 9: 流年事業分析 (Annual Career Analysis)

### Professional Methodology

| Flow Year Ten God | Career Implication (身強) | Career Implication (身弱) |
|-------------------|--------------------------|--------------------------|
| 正官 | Promotion, official recognition, stable career growth | Work pressure, bureaucratic obstacles |
| 七殺 | Bold career moves, competitive victory, leadership | Overwhelming work pressure, conflicts with superiors |
| 正印 | Learning year, certifications, mentor support, publishing | Complacency, over-reliance on credentials |
| 偏印 | Creative thinking, unconventional career paths | Isolation, career confusion, loss of direction |
| 正財 | Stable income growth, asset acquisition | Overwork, financial burden from career |
| 偏財 | Business expansion, investment opportunities | Risky business ventures fail |
| 食神 | Creative output, teaching, consulting success | Energy scattered, unfocused career efforts |
| 傷官 | Innovation, disruption, entrepreneurship | Conflicts with authority, career instability |
| 比肩 | Collaboration, networking, partnerships | Competition, loss of market share |
| 劫財 | Aggressive expansion, bold moves | Partner betrayal, financial disputes |

#### Career Event Signals

- **官印相生 in flow year**: Promotion + education leading to career elevation
- **食傷生財 chain**: Creative work → financial reward
- **傷官見官**: Career disruption (unless mediated by 財星)
- **比劫爭官**: Competition for position

### Our Implementation Status

**PARTIALLY COVERED**: Career analysis exists in 事業詳批 reading.
**GAP**: Need to adapt the career scoring framework for annual reading context.

---

## Research Area 10: 流年特殊格局和組合 (Special Patterns in Flow Year)

### 歲運並臨 (Luck Period = Flow Year)

When the flow year干支 is IDENTICAL to the current 大運干支, this is called 歲運並臨:
- If it's a 用神/喜神: Extremely auspicious — double the good fortune
- If it's an 忌神/仇神: Extremely dangerous — crisis year
- Special note: 「獨羊刃七殺為凶」 — if the 歲運並臨 involves 羊刃 or 七殺, it is particularly dangerous
- If it's 官/印/財 that are 用神: Very beneficial

### 天剋地沖 (Stem Clash + Branch Clash)

When flow year both stem-clashes AND branch-clashes a natal pillar simultaneously, this is the MOST violent interaction:
- With 年柱: Grandparents/parents crisis, family upheaval
- With 月柱: Career destruction, parents' health crisis
- With **日柱**: Personal/spouse major crisis — **most dangerous**
- With 時柱: Children's crisis, subordinate problems

### 流年逢空亡

When the flow year branch falls into the natal chart's 空亡:
- Even if the ten god is 用神 → effect is diminished ("好事落空")
- If the ten god is 忌神 → harm is also diminished ("壞事也落空") — actually protective
- Overall: 空亡 = events "fail to materialize" or are "empty/hollow"

### 流年見祿 (Prosperity Star in Flow Year)

Lookup table (Day Stem → 祿 Branch):
| Day Stem | 祿 in |
|----------|-------|
| 甲 | 寅 |
| 乙 | 卯 |
| 丙/戊 | 巳 |
| 丁/己 | 午 |
| 庚 | 申 |
| 辛 | 酉 |
| 壬 | 亥 |
| 癸 | 子 |

When flow year branch = 祿:
- Generally auspicious — income increase, support, resources
- BUT if 祿 is clashed or broken: Loss of income, family decline
- Body strong + 祿 as 忌神: Actually unfavorable (too much of same element)

### 羊刃 in Flow Year

羊刃 = 祿 + 1 position (帝旺 of day master). When flow year branch = 羊刃:
- Body strong: Danger signal — accidents, injuries, blood loss, surgery
- Body weak: Actually helpful — adds needed strength
- 羊刃 being clashed in flow year: **Highest danger** — 「羊刃逢沖，血光之災」

### 天地鴛鴦合 (Flow Year + Day Pillar Both Combine)

When flow year stem combines with day stem AND flow year branch combines with day branch:
- **Primary marriage signal** — extremely strong romance/marriage indicator
- Even for married people: year of deepened relationship or major romantic event
- Note: Not GUARANTEED marriage — depends on age, social context, and whether 夫妻星 is also activated

### Our Implementation Status

**PARTIALLY COVERED**: 伏吟/反吟/歲運並臨/天剋地沖/空亡 detection exists.
**GAP**: Need 祿神, 羊刃 flow year detection (lookup tables needed). Need 天地鴛鴦合 detection (new). Need nuanced interpretation based on 用神/忌神 role.

---

## Research Area 11: 流年與原局的沖合刑害破 (Branch Interactions)

### Interaction Power Ranking (CONFIRMED)

**Complete ranking from strongest to weakest**:

```
三會 > 三合 > 六沖 > 三刑 > 六合 > 半合 > 六害 > 六破
```

### Per-Pillar Impact When Flow Year Interacts

| Flow Year Branch Interaction | With 年支 | With 月支 | With 日支 | With 時支 |
|------------------------------|----------|----------|----------|----------|
| **六沖** | Elder/parent crisis | Career disruption, job change | Marriage crisis, personal upheaval | Children issues, late-life disruption |
| **六合** | Elder support | Career opportunity | Marriage enhancement, romance | Children's good fortune |
| **三合** | Extended family support | Industry alliance | Relationship network | Children's community |
| **三刑** | Family scandal | Legal/career trouble | Marriage legal issues | Children's injury/trouble |
| **六害** | Elder betrayal | Career backstabbing | Spouse deception | Children's disloyalty |
| **六破** | Minor elder issues | Minor career setback | Minor relationship crack | Minor children issue |

### 合中有沖, 沖中有合 (Compound Interactions)

When flow year creates BOTH a combination AND a clash with different natal pillars:
- The combination and clash coexist — they don't cancel out
- Example: Flow year 子 could 合 natal 丑 (六合) AND 沖 natal 午 (六沖) simultaneously
- Both effects manifest in their respective palace domains

### 合走用神 vs 合走忌神

- Flow year branch **combines with (合住) a 用神 branch**: BAD — the useful element is "tied up" and cannot function
- Flow year branch **combines with (合住) an 忌神 branch**: GOOD — the harmful element is "neutralized"
- This applies to both 六合 and 三合

### Our Implementation Status

**MOSTLY COVERED**: We have 六沖/六合/三合/三會/三刑/六害/六破 detection.
**GAP**: Need the "合走用神/忌神" analysis. Need per-pillar palace attribution for interpreting what the interaction MEANS in context.

---

## Research Area 12: 其他流年分析要素 (Other Flow Year Elements)

### 納音五行 (Nayin Five Elements)

**Professional status**: DISPUTED. Most modern professional masters (子平派) do NOT use 納音 for flow year analysis. It's considered an older system (唐宋) that has been largely superseded by the standard five-element analysis. Some folk practitioners still reference it.

**Recommendation**: Do NOT implement 納音 for our annual reading. It would add complexity without adding accuracy for our professional-grade product.

### 神煞 in Flow Year

**Which 神煞 matter for flow year analysis** (professional consensus):

| Shensha | Importance | Implementation |
|---------|-----------|----------------|
| 天乙貴人 | HIGH — most auspicious, getting help from nobles | Already implemented |
| 驛馬 | HIGH — travel, movement, relocation | Already implemented |
| 桃花 (咸池) | HIGH — romance | Already implemented |
| 文昌 | MEDIUM — academic, exams | Already implemented |
| 將星 | MEDIUM — leadership, authority | Already implemented |
| 紅鸞/天喜 | HIGH for romance readings | NEW — need to implement |
| 華蓋 | MEDIUM — spiritual, artistic, isolation | Can add |
| 天德/月德 | MEDIUM — protective stars, disaster mitigation | Can add |
| 紅艷 | LOW priority — romantic aesthetic | Skip for now |
| 亡神/劫煞 | MEDIUM — danger/accident signals | Can add for health section |

### 流年飛星 vs 八字流年

**These are COMPLETELY DIFFERENT systems**. 流年飛星 is Feng Shui (風水), not Bazi. We should NOT mix them.

**Recommendation**: Keep our product purely Bazi-based. Do not include Feng Shui flying stars.

### 歲破

歲破 = the branch that clashes with 太歲 (flow year branch). Example: 2024甲辰年, 歲破 is 戌.
- This is primarily a Feng Shui direction concept (不宜向歲破方動土)
- In Bazi context, this is simply the "六沖" of the flow year branch with a natal branch
- We already handle this as part of regular 六沖 detection

**Recommendation**: No separate implementation needed for 歲破 — it's covered by our existing 六沖 logic.

### 暗合 (Hidden Combination)

A more advanced concept where hidden stems in branches combine:
- Example: 卯 (hidden stem 乙) + 申 (hidden stem 庚) → 乙庚暗合
- Used in romance prediction (secret affairs, hidden relationships)
- Professional importance: MEDIUM — advanced practitioners use it, but it's not tier-1

**Recommendation**: Defer to a future enhancement. Not essential for v1 annual reading.

### 地支藏干 Activation (引動)

When flow year interacts with a natal branch, it "activates" the hidden stems inside that branch:
- The activated hidden stem then participates in the year's analysis
- Example: Flow year 沖 natal 申 → activates 庚(本氣)/壬(中氣)/戊(餘氣), causing those ten gods to manifest

**Recommendation**: This is implicit in our existing hidden stem weight system. No separate implementation needed, but we should mention it in AI prompt context.

---

## Summary: Implementation Gap Analysis

### Must-Have for v1 (Critical Gaps)

| # | Feature | Complexity | Notes |
|---|---------|-----------|-------|
| 1 | **Per-pillar palace attribution** (年=長輩, 月=事業, 日=配偶, 時=子女) | Low | Map interaction results to palace domains |
| 2 | **Flow year stem/branch harmony assessment** (干支通氣/蓋頭/截腳) | Low | New function, simple element comparison |
| 3 | **Flow year ten god → 用神/忌神 role mapping** | Low | Connect existing systems |
| 4 | **犯太歲 on ALL four pillar branches** (not just year) | Medium | Extend existing 太歲 check |
| 5 | **紅鸞/天喜 calculation + flow year activation** | Low | Simple lookup table from year branch |
| 6 | **天地鴛鴦合 detection** (flow year + day pillar both combine) | Low | Check stem合 + branch合 |
| 7 | **祿神/羊刃 in flow year** | Low | Lookup tables exist, need flow year context |
| 8 | **十二長生 health vitality indicator** | Low | Day master's 長生 position in flow year branch |
| 9 | **Four-aspect monthly assessment** (career/finance/romance/health) | High | New structured monthly output |
| 10 | **合走用神/忌神 analysis** | Medium | When flow year 合 a natal branch, check its role |
| 11 | **財庫逢沖 for annual wealth** | Low | Adapt from career reading |
| 12 | **Detailed天干→organ mapping for health** | Low | Lookup table |

### Nice-to-Have for v2

| # | Feature | Notes |
|---|---------|-------|
| 1 | 暗合 detection | Advanced romance prediction |
| 2 | 華蓋/天德/月德 shensha | Additional protective/artistic signals |
| 3 | 亡神/劫煞 shensha | Danger/accident signals for health |
| 4 | Flow month vs flow year interaction analysis | Month reinforces or clashes with year |

### Explicitly SKIP

| Feature | Reason |
|---------|--------|
| 納音五行 | Not used by professional modern masters |
| 流年飛星 | Feng Shui, not Bazi |
| 歲破 (separate) | Already covered by 六沖 logic |
| 近作用/遠作用 weighting | Not mainstream — disputed concept |
| 天干主上半年/地支主下半年 | Rejected by professional masters |

---

## Detailed Lookup Tables for Implementation

### 桃花星 (Peach Blossom) Lookup
Based on Day Branch (primary) and Year Branch (secondary):
- 申/子/辰 → 桃花 = 酉
- 寅/午/戌 → 桃花 = 卯
- 亥/卯/未 → 桃花 = 子
- 巳/酉/丑 → 桃花 = 午

### 紅鸞/天喜 Lookup (from Year Branch)
子→卯/酉, 丑→寅/申, 寅→丑/未, 卯→子/午, 辰→亥/巳, 巳→戌/辰, 午→酉/卯, 未→申/寅, 申→未/丑, 酉→午/子, 戌→巳/亥, 亥→辰/戌

### 祿神 Lookup (from Day Stem)
甲→寅, 乙→卯, 丙→巳, 丁→午, 戊→巳, 己→午, 庚→申, 辛→酉, 壬→亥, 癸→子

### 羊刃 Lookup (from Day Stem)
甲→卯, 乙→寅, 丙→午, 丁→巳, 戊→午, 己→巳, 庚→酉, 辛→申, 壬→子, 癸→亥

### 財庫 Lookup (from Day Master Element)
木→戌, 火→丑, 土→辰, 金→未, 水→戌

### 干支通氣/蓋頭/截腳 Assessment
For any pillar (stem, branch):
- 通氣: Stem element generates or is same as branch element → synergy
- 蓋頭: Stem element controls branch element → external pressure
- 截腳: Branch element controls stem element → internal undermining

### Branch Interaction Priority
三會 > 三合 > 六沖 > 三刑 > 六合 > 半合 > 六害 > 六破

---

## Sources Referenced

- [阐微堂 - 流年十神分析](https://www.chanweitang.com/post/118.html)
- [知乎 - 流年大运命局三者关系](https://zhuanlan.zhihu.com/p/1962778207959889865)
- [华易网 - 天干上半年地支下半年解读](https://m.k366.com/bazi/214709.htm)
- [知乎 - 犯太岁深度讲解](https://zhuanlan.zhihu.com/p/19279306116)
- [阐微堂 - 岁运并临](https://www.chanweitang.com/post/219.html)
- [算准网 - 伏吟和反吟](https://www.suanzhun.net/article/2224.html)
- [算准网 - 天干地支合化条件](https://www.suanzhun.net/article/2861.html)
- [知乎 - 十二长生应用详解](https://zhuanlan.zhihu.com/p/1916794447406031058)
- [豆瓣 - 地支刑冲合害破力量排序](https://www.douban.com/note/839492688/)
- [华易网 - 年月日时犯太岁](https://m.k366.com/bazi/219387.htm)
- [知乎 - 八字伏吟反吟详解](https://zhuanlan.zhihu.com/p/448546674)
- [知乎 - 地支相破](https://zhuanlan.zhihu.com/p/412215383)
- [算准网 - 流年流月分析](https://www.suanzhun.net/article/2223.html)
- [阐微堂 - 八字感情分析](https://chanweitang.com/post/168.html)
- [易安居 - 红鸾天喜星](https://m.zhouyi.cc/bazi/sm/15329.html)
- [知乎 - 禄神详解](https://zhuanlan.zhihu.com/p/1894719559166035888)
- [163 - 八字干支身体部位对照表](https://www.163.com/dy/article/GK11UEIE0548OATH.html)
- [算准网 - 辰戌丑未四墓库逢冲](https://www.suanzhun.net/article/2352.html)
- [华易网 - 天地合婚姻分析](https://m.k366.com/bazi/172169.htm)
- [星尘算命 - 岁运对命局关系](http://m-sz.kvov.com/sswzx.php?id=5323333666655556262)
- [163 - 命局大运流年三者作用关系](https://c.m.163.com/news/a/E08ABV1T0528BSHG.html)
- [易奇文化 - 流年看天干还是地支](https://www.yiqibazi.com/zonghefenxi/18847.html)
