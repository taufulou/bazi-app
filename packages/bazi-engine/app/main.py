"""
Bazi Calculation Engine - FastAPI Microservice
Layer 1: Deterministic Bazi calculation from birth data.
All calculations are deterministic (no AI). AI interpretation is handled by the NestJS API.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

app = FastAPI(
    title="Bazi Calculation Engine",
    description="八字排盤計算引擎 - Deterministic Four Pillars calculation",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000"],  # NestJS API only
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)


class BirthDataInput(BaseModel):
    """Input for Bazi calculation."""
    birth_date: str = Field(..., description="Birth date in YYYY-MM-DD format")
    birth_time: str = Field(..., description="Birth time in HH:MM format")
    birth_city: str = Field(..., description="Birth city name for geocoding")
    birth_longitude: Optional[float] = Field(None, description="Birth city longitude (if pre-geocoded)")
    birth_latitude: Optional[float] = Field(None, description="Birth city latitude (if pre-geocoded)")
    gender: str = Field(..., pattern="^(male|female)$", description="Gender: male or female")
    target_year: Optional[int] = Field(None, description="Target year for annual forecast")


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    service: str
    version: str
    timestamp: str


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
async def calculate_bazi(data: BirthDataInput):
    """
    Calculate Bazi (Four Pillars) from birth data.

    This is a stub that returns a placeholder response.
    Full implementation will be added in Phase 2 (Step 5).
    """
    # TODO: Phase 2 - Implement full Bazi calculation
    # 1. True Solar Time adjustment (真太陽時)
    # 2. Solar-to-Lunar calendar conversion
    # 3. Four Pillars calculation
    # 4. Heavenly Stems & Earthly Branches
    # 5. Hidden Stems (藏干)
    # 6. Ten Gods (十神)
    # 7. Five Elements balance
    # 8. Day Master analysis
    # 9. Na Yin (納音)
    # 10. Shen Sha (神煞)
    # 11. Luck Periods (大運)
    # 12. Annual/Monthly Stars (流年/流月)

    return {
        "status": "stub",
        "message": "Bazi calculation engine - full implementation in Phase 2",
        "input": data.model_dump(),
    }


@app.post("/compatibility")
async def calculate_compatibility(
    profile_a: BirthDataInput,
    profile_b: BirthDataInput,
):
    """
    Calculate compatibility between two Bazi charts.

    This is a stub that returns a placeholder response.
    Full implementation will be added in Phase 2 (Step 6).
    """
    return {
        "status": "stub",
        "message": "Compatibility calculation - full implementation in Phase 2",
        "profile_a": profile_a.model_dump(),
        "profile_b": profile_b.model_dump(),
    }
