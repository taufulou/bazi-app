"""
Bazi Calculation Engine — FastAPI Microservice
Layer 1: Deterministic Bazi calculation from birth data.
All calculations are deterministic (no AI). AI interpretation is handled by the NestJS API.
"""

import time
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .calculator import calculate_bazi, calculate_bazi_compatibility

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


class CompatibilityInput(BaseModel):
    """Input for compatibility comparison."""
    profile_a: BirthDataInput = Field(..., description="First person's birth data")
    profile_b: BirthDataInput = Field(..., description="Second person's birth data")
    comparison_type: str = Field(
        "romance",
        pattern="^(romance|business|friendship)$",
        description="Type of comparison",
        examples=["romance"],
    )


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

    Returns both individual charts and a detailed compatibility analysis including:
    - Overall compatibility score (0-100)
    - Day Master interaction
    - Stem combinations (天干合)
    - Branch relationships (六合/六沖/六害)
    - Five Elements complementarity
    - Strengths and challenges
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
