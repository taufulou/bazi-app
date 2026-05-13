"""
Bazi Calculation Engine — FastAPI Microservice
Layer 1: Deterministic Bazi calculation from birth data.
All calculations are deterministic (no AI). AI interpretation is handled by the NestJS API.
"""

import time
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .calculator import (
    calculate_bazi,
    calculate_bazi_compatibility,
    calculate_bazi_with_all_pipelines,
)
from .chat_context import build_chat_context, build_chat_context_compat
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
