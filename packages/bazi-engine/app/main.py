"""
Bazi Calculation Engine — FastAPI Microservice
Layer 1: Deterministic Bazi calculation from birth data.
All calculations are deterministic (no AI). AI interpretation is handled by the NestJS API.
"""

import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .calculator import (
    calculate_bazi,
    calculate_bazi_compatibility,
    calculate_bazi_with_all_pipelines,
)
from .chat_context import (
    build_chat_context,
    build_chat_context_compat,
    build_chat_context_fortune,
)
from .daily_enhanced import compute_daily_fortune, resolve_bazi_today_from_clock_time
from .explanations import get_element_explanation

app = FastAPI(
    title="Bazi Calculation Engine",
    description="八字排盤計算引擎 — Deterministic Four Pillars calculation with True Solar Time",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000", "http://localhost:3000"],  # NestJS API + Next.js dev
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ============================================================
# Request/Response Models
# ============================================================

class BirthDataInput(BaseModel):
    """Input for Bazi calculation."""
    birth_date: str = Field(
        ...,
        description="Birth date in YYYY-MM-DD format",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
        examples=["1990-05-15"],
    )
    birth_time: str = Field(
        ...,
        description="Birth time in HH:MM format (24-hour)",
        pattern=r"^([01]\d|2[0-3]):([0-5]\d)$",
        examples=["14:30"],
    )
    birth_city: str = Field(
        ...,
        description="Birth city name (Chinese or English)",
        examples=["台北市"],
    )
    birth_timezone: str = Field(
        ...,
        description="IANA timezone string",
        examples=["Asia/Taipei"],
    )
    birth_longitude: Optional[float] = Field(
        None,
        description="Birth city longitude (if pre-geocoded)",
        examples=[121.5654],
    )
    birth_latitude: Optional[float] = Field(
        None,
        description="Birth city latitude (if pre-geocoded)",
        examples=[25.033],
    )
    gender: str = Field(
        ...,
        pattern="^(male|female)$",
        description="Gender: male or female",
        examples=["male"],
    )
    target_year: Optional[int] = Field(
        None,
        description="Target year for annual forecast (default: current year)",
        examples=[2026],
    )
    reading_type: Optional[str] = Field(
        None,
        description="Reading type for conditional computation (e.g., 'lifetime' for enhanced insights)",
        examples=["lifetime"],
    )


class CompatibilityInput(BaseModel):
    """Input for compatibility comparison."""
    profile_a: BirthDataInput = Field(..., description="First person's birth data")
    profile_b: BirthDataInput = Field(..., description="Second person's birth data")
    comparison_type: str = Field(
        "romance",
        pattern="^(romance|business|friendship|parent_child)$",
        description="Type of comparison: romance, business, friendship, or parent_child",
        examples=["romance"],
    )
    current_year: Optional[int] = Field(
        None,
        description="Year for timing analysis (defaults to current year if not provided)",
    )


class GodRolesInput(BaseModel):
    """Structured god roles for element explanation.

    These are the EFFECTIVE god roles (post-從格 override if applicable).
    The frontend extracts these from chartData.dayMaster which already
    reflects the engine's 從格 detection and god role inversion.
    """
    dayMasterElement: str = Field(..., description="DM element: 木/火/土/金/水")
    strengthClassification: str = Field(
        ..., description="DM strength: very_weak/weak/neutral/strong/very_strong"
    )
    favorableGod: str = Field("", description="喜神 element (effective)")
    usefulGod: str = Field("", description="用神 element (effective)")
    idleGod: str = Field("", description="閒神 element (effective)")
    tabooGod: str = Field("", description="忌神 element (effective)")
    enemyGod: str = Field("", description="仇神 element (effective)")


_VALID_STEMS = {'甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'}
_VALID_BRANCHES = {'子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'}


class PillarInput(BaseModel):
    """Individual pillar data for cross-pillar interaction detection."""
    stem: str = Field(..., description="Heavenly stem: 甲-癸")
    branch: str = Field(..., description="Earthly branch: 子-亥")
    tenGod: str = Field("", description="Ten god of this pillar's stem (empty for day pillar)")
    hiddenStemGods: List[str] = Field(
        default_factory=list,
        description="Ten god names of hidden stems, e.g. ['食神','偏官','偏印']",
    )

    @field_validator('stem')
    @classmethod
    def validate_stem(cls, v: str) -> str:
        if v not in _VALID_STEMS:
            raise ValueError(f'Invalid stem: {v}. Must be one of {_VALID_STEMS}')
        return v

    @field_validator('branch')
    @classmethod
    def validate_branch(cls, v: str) -> str:
        if v not in _VALID_BRANCHES:
            raise ValueError(f'Invalid branch: {v}. Must be one of {_VALID_BRANCHES}')
        return v


class ExplainElementInput(BaseModel):
    """Input for element explanation lookup."""
    element_type: str = Field(
        ...,
        description="Element type: ten_god|stem|branch|hidden_stem|life_stage|nayin|shensha|seasonal_state|kong_wang",
    )
    value: str = Field(..., description="The element value, e.g. '正官', '甲', '子'")
    pillar: str = Field(..., description="Pillar position: year|month|day|hour")
    god_roles: GodRolesInput = Field(..., description="Minimal chart context")
    gender: str = Field("male", description="Gender: male|female")
    # Optional: for cross-pillar interaction detection (~500 bytes)
    four_pillars: Optional[Dict[str, PillarInput]] = Field(
        None, description="Full four pillar data for cross-pillar interaction detection",
    )

    @field_validator('four_pillars')
    @classmethod
    def validate_four_pillars(cls, v: Optional[Dict[str, 'PillarInput']]) -> Optional[Dict[str, 'PillarInput']]:
        if v is not None:
            required = {'year', 'month', 'day', 'hour'}
            if set(v.keys()) != required:
                raise ValueError(f'four_pillars must have exactly these keys: {required}')
        return v


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    service: str
    version: str
    timestamp: str


# ============================================================
# Endpoints
# ============================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="bazi-engine",
        version="1.0.0",
        timestamp=datetime.utcnow().isoformat(),
    )


@app.post("/calculate")
async def calculate_bazi_endpoint(data: BirthDataInput):
    """
    Calculate Bazi (Four Pillars) from birth data.

    Returns a complete Bazi chart including:
    - True Solar Time adjustment
    - Four Pillars (年柱/月柱/日柱/時柱)
    - Heavenly Stems & Earthly Branches
    - Hidden Stems (藏干)
    - Ten Gods (十神)
    - Five Elements balance (五行)
    - Day Master analysis (日主旺衰)
    - Na Yin (納音)
    - Shen Sha (神煞)
    - Life Stages (十二長生)
    - Luck Periods (大運)
    - Annual Stars (流年)
    - Monthly Stars (流月)
    """
    start_time = time.perf_counter()

    try:
        result = calculate_bazi(
            birth_date=data.birth_date,
            birth_time=data.birth_time,
            birth_city=data.birth_city,
            birth_timezone=data.birth_timezone,
            gender=data.gender,
            birth_longitude=data.birth_longitude,
            birth_latitude=data.birth_latitude,
            target_year=data.target_year,
            reading_type=data.reading_type,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            "status": "success",
            "calculationTimeMs": elapsed_ms,
            "data": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Calculation error: {str(e)}",
        )


@app.post("/compatibility")
async def calculate_compatibility_endpoint(data: CompatibilityInput):
    """
    Calculate compatibility between two Bazi charts.

    Returns both individual charts and a comprehensive compatibility analysis:
    - compatibility: Legacy simple scoring (backward compat)
    - compatibilityEnhanced: 8-dimension scoring with sigmoid amplification,
      knockout conditions, and special label assignment
    - compatibilityPreAnalysis: Structured pre-analysis for AI narration,
      including cross-chart Ten God analysis, landmine warnings, attraction
      analysis, and timing sync — every relationship is pre-computed
    """
    start_time = time.perf_counter()

    try:
        birth_data_a = {
            'birth_date': data.profile_a.birth_date,
            'birth_time': data.profile_a.birth_time,
            'birth_city': data.profile_a.birth_city,
            'birth_timezone': data.profile_a.birth_timezone,
            'gender': data.profile_a.gender,
            'birth_longitude': data.profile_a.birth_longitude,
            'birth_latitude': data.profile_a.birth_latitude,
            'target_year': data.profile_a.target_year,
        }
        birth_data_b = {
            'birth_date': data.profile_b.birth_date,
            'birth_time': data.profile_b.birth_time,
            'birth_city': data.profile_b.birth_city,
            'birth_timezone': data.profile_b.birth_timezone,
            'gender': data.profile_b.gender,
            'birth_longitude': data.profile_b.birth_longitude,
            'birth_latitude': data.profile_b.birth_latitude,
            'target_year': data.profile_b.target_year,
        }

        result = calculate_bazi_compatibility(
            birth_data_a=birth_data_a,
            birth_data_b=birth_data_b,
            comparison_type=data.comparison_type,
            current_year=data.current_year,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            "status": "success",
            "calculationTimeMs": elapsed_ms,
            "data": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Compatibility calculation error: {str(e)}",
        )


class ChatContextInput(BaseModel):
    """Input for building the slim chat context for the AI chat feature."""
    birth_date: str = Field(
        ...,
        description="Birth date YYYY-MM-DD",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )
    birth_time: str = Field(
        ...,
        description="Birth time HH:MM",
        pattern=r"^([01]\d|2[0-3]):([0-5]\d)$",
    )
    birth_city: str
    birth_timezone: str
    gender: str = Field(..., pattern=r"^(male|female)$")
    birth_longitude: Optional[float] = None
    birth_latitude: Optional[float] = None
    target_year: Optional[int] = Field(None, ge=1900, le=2100)
    target_month: Optional[int] = Field(None, ge=1, le=12)


@app.post("/build-chat-context")
async def build_chat_context_endpoint(data: ChatContextInput):
    """
    Build the slim AI chat context payload (per next-the-big-feature-proud-manatee
    plan). Always runs all 4 enhanced pipelines (lifetime + love + career + annual)
    regardless of reading_type, then slims to ~10-14k tokens with deterministic
    Chinese doctrine injection blocks.

    The central anti-hallucination win: surfaces 傷官見官 valence='beneficial' (and
    other Phase 12g/h/i flags) for the AI to consume verbatim — no folk doctrine
    fallback. Mirrors the deterministic-injection pattern already used by
    `interpolateLoveV2Fields` in apps/api/src/ai/ai.service.ts:3794-3837.

    Compute cost: ~50-100ms; cached at the NestJS layer with key
    `chat-context:{birthHash}:{versions}` and 24h TTL.
    """
    start_time = time.perf_counter()

    try:
        chart = calculate_bazi_with_all_pipelines(
            birth_date=data.birth_date,
            birth_time=data.birth_time,
            birth_city=data.birth_city,
            birth_timezone=data.birth_timezone,
            gender=data.gender,
            birth_longitude=data.birth_longitude,
            birth_latitude=data.birth_latitude,
            target_year=data.target_year,
        )

        ctx = build_chat_context(
            chart_data=chart,
            current_year=data.target_year or datetime.now().year,
            current_month=data.target_month or datetime.now().month,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            "status": "success",
            "calculationTimeMs": elapsed_ms,
            "chatContext": ctx,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Chat context build error: {str(e)}",
        )


class CompatChatContextInput(BaseModel):
    """Phase 3 — input for building the slim chat context for COMPATIBILITY chat (two parties).

    L2 (Phase 3 follow-up): `comparison_type` deliberately excludes
    `parent_child` (which `CompatibilityInput` accepts for non-chat compat
    workflows). Phase 3 ships ROMANCE chat only; BUSINESS / FRIENDSHIP /
    PARENT_CHILD chat support is deferred to Phase 4+. The NestJS layer
    also enforces ROMANCE-only at session create (chat.service.ts H6 fix).
    """
    profile_a: ChatContextInput
    profile_b: ChatContextInput
    comparison_type: str = Field(default="romance", pattern=r"^(romance|business|friendship)$")
    target_year: int = Field(..., ge=1900, le=2100)
    target_month: int = Field(..., ge=1, le=12)


@app.post("/build-chat-context-compat")
async def build_chat_context_compat_endpoint(data: CompatChatContextInput):
    """
    Phase 3 — build the slim chat context for COMPATIBILITY chat. Calls
    calculate_bazi_with_all_pipelines for BOTH parties, runs
    calculate_enhanced_compatibility, then slims to ~11-15k tokens.

    Cross-chart 三刑/半刑/子卯刑/六沖/六害 findings (Phase 12i) surface
    via `crossChartFindings`. Per-party doctrineFlags filtered to LOVE-domain
    only (drops patternClassification/isCongGe/careerPatternType to avoid
    leaking CAREER/LIFETIME doctrine).

    The chat layer surfaces engine's `label` field verbatim — matches the
    result page (COMPATIBILITY_LABELS 8 base + 3 SPECIAL overrides).
    """
    start_time = time.perf_counter()

    try:
        birth_data_a = {
            'birth_date': data.profile_a.birth_date,
            'birth_time': data.profile_a.birth_time,
            'birth_city': data.profile_a.birth_city,
            'birth_timezone': data.profile_a.birth_timezone,
            'gender': data.profile_a.gender,
            'birth_longitude': data.profile_a.birth_longitude,
            'birth_latitude': data.profile_a.birth_latitude,
        }
        birth_data_b = {
            'birth_date': data.profile_b.birth_date,
            'birth_time': data.profile_b.birth_time,
            'birth_city': data.profile_b.birth_city,
            'birth_timezone': data.profile_b.birth_timezone,
            'gender': data.profile_b.gender,
            'birth_longitude': data.profile_b.birth_longitude,
            'birth_latitude': data.profile_b.birth_latitude,
        }

        ctx = build_chat_context_compat(
            birth_data_a=birth_data_a,
            birth_data_b=birth_data_b,
            comparison_type=data.comparison_type,
            current_year=data.target_year,
            current_month=data.target_month,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            "status": "success",
            "calculationTimeMs": elapsed_ms,
            "chatContext": ctx,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Compat chat context build error: {str(e)}",
        )


class FortuneChatContextInput(BaseModel):
    """Phase Fortune — input for building the FORTUNE chat-scope context
    (single chart's daily fortune + chart-slim base).

    `precomputed_daily` is the Issue 1 optimization: when the NestJS layer
    already has the persisted `DailyFortuneSnapshot.engineOutputJson` for
    the same `(chart_hash, anchor_date)`, it passes the snapshot through
    so the engine can skip the redundant `compute_daily_fortune()` call
    (saves ~50-100ms per chat session create on the warm-snapshot path).

    Caller is responsible for resolving the 23:00 子時 boundary against
    Asia/Taipei BEFORE sending — use the NestJS-side
    `fortune.service.ts::todayIsoDate()` helper.
    """
    birth_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    birth_time: str = Field(..., pattern=r"^([01]\d|2[0-3]):([0-5]\d)$")
    birth_city: str
    birth_timezone: str
    gender: str = Field(..., pattern=r"^(male|female)$")
    birth_longitude: Optional[float] = None
    birth_latitude: Optional[float] = None
    anchor_date: str = Field(
        ..., description="Bazi-day-resolved date YYYY-MM-DD",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )
    target_year: int = Field(..., ge=1900, le=2100)
    target_month: int = Field(..., ge=1, le=12)
    precomputed_daily: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Optional persisted DailyFortuneSnapshot.engineOutputJson — when "
                    "provided, skips compute_daily_fortune (Issue 1 reuse path)",
    )


@app.post("/build-chat-context-fortune")
async def build_chat_context_fortune_endpoint(data: FortuneChatContextInput):
    """Phase Fortune — build the slim chat context for FORTUNE chat (八字日運).

    Merges the single-chart 4-pipeline slim (lifetime/love/career/annual)
    PLUS the day's fortune output (`dailyFortune`). The chat AI inherits
    ALL chart-level Phase 12 doctrine via the merged slim's `doctrineFlags`
    + `doctrineInjectors` — day-pillar TRANSIENT findings ride in
    `dailyFortune.dimensions[].signals[]` for the NestJS-side
    `interpolateFortuneV1Fields` injector to consume.

    Compute cost: ~50-100ms cold-cache. With `precomputed_daily` provided,
    drops to ~30-50ms (skips compute_daily_fortune). NestJS caches by
    `chat-context-fortune:{birthHash}:{anchorDateIso}:{versions}` 24h TTL.
    """
    start_time = time.perf_counter()

    try:
        birth_data = {
            'birth_date': data.birth_date,
            'birth_time': data.birth_time,
            'birth_city': data.birth_city,
            'birth_timezone': data.birth_timezone,
            'gender': data.gender,
            'birth_longitude': data.birth_longitude,
            'birth_latitude': data.birth_latitude,
        }

        ctx = build_chat_context_fortune(
            birth_data=birth_data,
            anchor_date=data.anchor_date,
            current_year=data.target_year,
            current_month=data.target_month,
            precomputed_daily=data.precomputed_daily,
        )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            "status": "success",
            "calculationTimeMs": elapsed_ms,
            "chatContext": ctx,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Fortune chat context build error: {str(e)}",
        )


class DailyFortuneInput(BaseModel):
    """Input for daily fortune computation (八字日運).

    The endpoint accepts birth data + target_date and internally computes
    the full chart context (用神/喜神/忌神, 空亡, 從格, 強弱, 流年/月) then
    delegates to `compute_daily_fortune`. The NestJS API layer caches the
    full result by `(chart_hash, date)` so we only re-compute when the
    cache misses.

    See `.claude/plans/ok-next-big-feature-merry-cake.md` for the binding
    plan.
    """
    birth_date: str = Field(
        ..., description="Birth date YYYY-MM-DD",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )
    birth_time: str = Field(
        ..., description="Birth time HH:MM",
        pattern=r"^([01]\d|2[0-3]):([0-5]\d)$",
    )
    birth_city: str
    birth_timezone: str
    gender: str = Field(..., pattern=r"^(male|female)$")
    birth_longitude: Optional[float] = None
    birth_latitude: Optional[float] = None
    target_date: str = Field(
        ..., description="Target date YYYY-MM-DD (caller resolves 23:00 子時 boundary before sending)",
        pattern=r"^\d{4}-\d{2}-\d{2}$",
    )
    target_year: Optional[int] = Field(
        None, ge=1900, le=2100,
        description="Flow year for context (defaults to target_date's year)",
    )


@app.post("/daily-fortune")
async def daily_fortune_endpoint(data: DailyFortuneInput):
    """Compute 八字日運 (daily fortune) for the given chart on a target date.

    Returns the engine's deterministic daily pre-analysis:
    - 7-label 吉凶 + derived 0-100 energy score
    - 5 dimension sub-scores (感情/事業/財運/出行/健康) with signals
    - Folk content (static 用神 wealth direction)
    - `metaFraming='soft_trigger'` (load-bearing for AI prompt
      anti-hallucination — daily fortune is a TRIGGER, not a verdict)

    The Bazi day boundary is 23:00 (子時 start), NOT midnight. The CALLER
    (NestJS layer) is responsible for resolving the correct Bazi-day
    target_date from local clock time BEFORE calling this endpoint — use
    `resolve_bazi_today_from_clock_time` for that.

    Cache strategy (recommended at NestJS layer): key by
    `(chart_hash, target_date, FORTUNE_DAILY_PRE_ANALYSIS_VERSION)`, TTL
    24h. Persist to DB for subscriber lookback.
    """
    from datetime import date as _date

    start_time = time.perf_counter()

    try:
        # Parse target date
        try:
            target_date_obj = _date.fromisoformat(data.target_date)
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=f'Invalid target_date: {ve}')

        # Default flow year = target date's year
        flow_year = data.target_year or target_date_obj.year

        # Run full chart pipeline (includes 用神/喜神/忌神 + 從格 detection +
        # flow year metadata via annualEnhancedInsights)
        chart = calculate_bazi_with_all_pipelines(
            birth_date=data.birth_date,
            birth_time=data.birth_time,
            birth_city=data.birth_city,
            birth_timezone=data.birth_timezone,
            gender=data.gender,
            birth_longitude=data.birth_longitude,
            birth_latitude=data.birth_latitude,
            target_year=flow_year,
        )

        # Extract daily-fortune inputs from full chart
        pillars = chart['fourPillars']
        day_master = chart['dayMaster']
        effective_gods = {
            'usefulGod': day_master.get('usefulGod', ''),
            'favorableGod': day_master.get('favorableGod', ''),
            'idleGod': day_master.get('idleGod', ''),
            'tabooGod': day_master.get('tabooGod', ''),
            'enemyGod': day_master.get('enemyGod', ''),
        }
        is_cong_ge = bool(chart.get('lifetimeEnhancedInsights', {})
                          .get('deterministic', {})
                          .get('cong_ge_detected'))

        # Flow-year info for the day's context
        annual_insights = chart.get('annualEnhancedInsights', {})
        flow_year_data = annual_insights.get('flowYear', {})
        flow_year_stem = flow_year_data.get('stem', '')
        flow_year_auspiciousness = flow_year_data.get('auspiciousness', '平')

        daily_result = compute_daily_fortune(
            pillars=pillars,
            day_master_stem=chart['dayMasterStem'],
            effective_gods=effective_gods,
            useful_god_element=day_master.get('usefulGod', '土'),
            gender=data.gender,
            kong_wang=chart.get('kongWang', []),
            strength=day_master.get('strength', 'neutral'),
            is_cong_ge=is_cong_ge,
            target_date=target_date_obj,
            flow_year_stem=flow_year_stem,
            flow_year_auspiciousness=flow_year_auspiciousness,
        )

        # Attach chart context so the NestJS layer can build the AI prompt
        # without re-calling /calculate. Mirrors the data the prompt builder's
        # FortuneChartContext expects.
        daily_result['chartContext'] = {
            'gender': data.gender,
            'birthDate': data.birth_date,
            'birthTime': data.birth_time,
            'lunarDate': (
                f"農曆{chart.get('lunarDate', {}).get('year', '?')}-"
                f"{chart.get('lunarDate', {}).get('month', '?')}-"
                f"{chart.get('lunarDate', {}).get('day', '?')}"
                if chart.get('lunarDate') else None
            ),
            'yearPillar': pillars['year']['stem'] + pillars['year']['branch'],
            'monthPillar': pillars['month']['stem'] + pillars['month']['branch'],
            'dayPillar': pillars['day']['stem'] + pillars['day']['branch'],
            'hourPillar': pillars['hour']['stem'] + pillars['hour']['branch'],
            'yearTenGod': pillars['year'].get('tenGod', ''),
            'monthTenGod': pillars['month'].get('tenGod', ''),
            'hourTenGod': pillars['hour'].get('tenGod', ''),
            'dayMaster': chart['dayMasterStem'],
            'dayMasterElement': day_master.get('element', ''),
            'dayMasterYinYang': day_master.get('yinYang', ''),
            'strengthV2': day_master.get('strength', 'neutral'),
            'usefulGod': day_master.get('usefulGod', ''),
            'favorableGod': day_master.get('favorableGod', ''),
            'tabooGod': day_master.get('tabooGod', ''),
            'enemyGod': day_master.get('enemyGod', ''),
        }

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

        return {
            'status': 'success',
            'calculationTimeMs': elapsed_ms,
            'data': daily_result,
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Daily fortune calculation error: {str(e)}",
        )


@app.post("/explain-element")
async def explain_element(data: ExplainElementInput):
    """
    Look up pre-computed explanation for a Bazi chart element.

    Returns all layers (A/B/C/D) — the frontend gates paid content
    using its own isSubscriber state. No subscription check server-side.
    Templates are educational reference content loaded from JSON files.
    """
    four_pillars_dict = None
    if data.four_pillars:
        four_pillars_dict = {
            k: v.model_dump() for k, v in data.four_pillars.items()
        }

    result = get_element_explanation(
        element_type=data.element_type,
        value=data.value,
        pillar=data.pillar,
        god_roles=data.god_roles.model_dump(),
        gender=data.gender,
        four_pillars=four_pillars_dict,
    )
    return {"status": "success", "data": result}
