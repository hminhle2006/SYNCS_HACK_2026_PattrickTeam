"""Lane A tests for shared interfaces that must remain stable."""
import math

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.schemas import RouteRequest, RouteResponse
from backend.routing.cost import edge_cost


def test_health_contract() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert set(response.json()) == {"status", "cache_ready", "version"}
    assert response.json()["status"] == "ok"


def test_route_request_bounds() -> None:
    request = RouteRequest(
        origin={"lat": -33.8913, "lon": 151.1980},
        destination={"lat": -33.8870, "lon": 151.1902},
        hour=14,
        shade_preference=0.8,
    )
    assert request.hour == 14
    with pytest.raises(ValidationError):
        RouteRequest(
            origin={"lat": math.nan, "lon": 151.1980},
            destination={"lat": -33.8870, "lon": 151.1902},
            hour=14,
            shade_preference=0.8,
        )


def test_route_response_order_is_stable() -> None:
    base = {
        "geometry": {
            "type": "LineString",
            "coordinates": [[151.1980, -33.8913], [151.1902, -33.8870]],
        },
        "distance_m": 1000.0,
        "duration_s": 740.7,
        "exposed_m": 600.0,
        "exposed_frac": 0.6,
    }
    response = RouteResponse.model_validate(
        {
            "routes": [
                {"type": "fastest", **base},
                {"type": "coolest", **base},
            ],
            "comparison": {
                "extra_distance_m": 0.0,
                "extra_duration_s": 0.0,
                "exposure_reduction_m": 0.0,
                "exposure_reduction_pct": 0.0,
            },
            "meta": {
                "hour": 14,
                "shade_preference": 0.8,
                "timezone": "Australia/Sydney",
            },
        }
    )
    assert [route.type for route in response.routes] == ["fastest", "coolest"]


def test_cost_increases_with_exposure_and_preference() -> None:
    baseline = edge_cost(100.0, exposed_frac=0.0, shade_preference=1.0)
    exposed = edge_cost(100.0, exposed_frac=1.0, shade_preference=1.0)
    indifferent = edge_cost(100.0, exposed_frac=1.0, shade_preference=0.0)
    assert baseline == 100.0
    assert exposed > baseline
    assert indifferent == 100.0
