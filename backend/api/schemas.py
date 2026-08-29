"""Stable public API schemas. Field names must not change unilaterally."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Coordinate(StrictModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lon: float = Field(ge=-180.0, le=180.0)

    @field_validator("lat", "lon")
    @classmethod
    def finite(cls, value: float) -> float:
        if not float(value) == value or value in (float("inf"), float("-inf")):
            raise ValueError("coordinate must be finite")
        return value


class RouteRequest(StrictModel):
    origin: Coordinate
    destination: Coordinate
    hour: int = Field(ge=6, le=19)
    shade_preference: float = Field(ge=0.0, le=1.0)


class LineStringGeometry(StrictModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[float, float]] = Field(min_length=2)


class RouteOption(StrictModel):
    type: Literal["fastest", "coolest"]
    geometry: LineStringGeometry
    distance_m: float = Field(ge=0.0)
    duration_s: float = Field(ge=0.0)
    exposed_m: float = Field(ge=0.0)
    exposed_frac: float = Field(ge=0.0, le=1.0)


class RouteComparison(StrictModel):
    extra_distance_m: float = Field(ge=0.0)
    extra_duration_s: float = Field(ge=0.0)
    exposure_reduction_m: float
    exposure_reduction_pct: float


class RouteMeta(StrictModel):
    hour: int = Field(ge=6, le=19)
    shade_preference: float = Field(ge=0.0, le=1.0)
    timezone: Literal["Australia/Sydney"] = "Australia/Sydney"


class RouteResponse(StrictModel):
    routes: list[RouteOption] = Field(min_length=2, max_length=2)
    comparison: RouteComparison
    meta: RouteMeta

    @field_validator("routes")
    @classmethod
    def stable_route_order(cls, routes: list[RouteOption]) -> list[RouteOption]:
        if [item.type for item in routes] != ["fastest", "coolest"]:
            raise ValueError("routes must be ordered fastest, coolest")
        return routes


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"
    cache_ready: bool
    version: str


class UVIndex(StrictModel):
    hour: int = Field(ge=6, le=19)
    uv_index: float = Field(ge=0.0)
    source: Literal["arpansa", "clear-sky model"]
    is_live: bool
    observed_at: str | None = None


class UVDoseResponse(StrictModel):
    uv: UVIndex
    fastest_sed: float = Field(ge=0.0)
    coolest_sed: float = Field(ge=0.0)
    uv_reduction_sed: float
    uv_reduction_pct: float
    fastest_minutes_to_burn: float | None
    coolest_minutes_to_burn: float | None
    meta: RouteMeta


class ErrorDetail(StrictModel):
    code: Literal[
        "INVALID_COORDINATES",
        "INVALID_HOUR",
        "SAME_GRAPH_NODE",
        "OUTSIDE_DEMO_AREA",
        "NO_PATH",
        "CACHE_NOT_READY",
        "INTERNAL_ROUTING_ERROR",
    ]
    message: str


class ErrorResponse(StrictModel):
    detail: ErrorDetail
