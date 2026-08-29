"""Hard-coded mock routes so Lane D can build against /api/route today.

Replaced from the inside once real routing lands; the response shape is
owned by backend/api/schemas.py and never changes.
"""
import math

from backend.api.schemas import (
    LineStringGeometry,
    RouteComparison,
    RouteMeta,
    RouteOption,
    RouteRequest,
    RouteResponse,
)
from backend.config import WALKING_SPEED_MPS

# Demo pair: Redfern Station -> University of Sydney (see backend/config.py).
# Direct line via Lawson St and Abercrombie St.
FASTEST_COORDS: list[tuple[float, float]] = [
    (151.1980, -33.8913),
    (151.1972, -33.8907),
    (151.1958, -33.8900),
    (151.1943, -33.8892),
    (151.1928, -33.8884),
    (151.1914, -33.8877),
    (151.1902, -33.8870),
]

# Detour through the Darlington back streets (Shepherd St / Golden Grove St).
COOLEST_COORDS: list[tuple[float, float]] = [
    (151.1980, -33.8913),
    (151.1976, -33.8919),
    (151.1962, -33.8921),
    (151.1950, -33.8913),
    (151.1939, -33.8904),
    (151.1929, -33.8895),
    (151.1917, -33.8886),
    (151.1907, -33.8878),
    (151.1902, -33.8870),
]

# Sunny corridor vs a tree-lined detour whose benefit scales with preference.
FASTEST_EXPOSED_FRAC = 0.72
COOLEST_EXPOSED_FRAC_MAX = 0.55
COOLEST_EXPOSED_FRAC_MIN = 0.30

_EARTH_RADIUS_M = 6_371_000.0


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(h))


def _line_length_m(coords: list[tuple[float, float]]) -> float:
    return sum(_haversine_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def _route_option(
    kind: str, coords: list[tuple[float, float]], exposed_frac: float
) -> RouteOption:
    distance_m = _line_length_m(coords)
    exposed_m = distance_m * exposed_frac
    return RouteOption(
        type=kind,
        geometry=LineStringGeometry(coordinates=coords),
        distance_m=round(distance_m, 1),
        duration_s=round(distance_m / WALKING_SPEED_MPS, 1),
        exposed_m=round(exposed_m, 1),
        exposed_frac=round(exposed_frac, 3),
    )


def build_mock_response(request: RouteRequest) -> RouteResponse:
    """Contract-shaped response; only exposure reacts to shade_preference."""
    coolest_frac = COOLEST_EXPOSED_FRAC_MAX - (
        (COOLEST_EXPOSED_FRAC_MAX - COOLEST_EXPOSED_FRAC_MIN)
        * request.shade_preference
    )
    fastest = _route_option("fastest", FASTEST_COORDS, FASTEST_EXPOSED_FRAC)
    coolest = _route_option("coolest", COOLEST_COORDS, coolest_frac)
    comparison = RouteComparison(
        extra_distance_m=round(coolest.distance_m - fastest.distance_m, 1),
        extra_duration_s=round(coolest.duration_s - fastest.duration_s, 1),
        exposure_reduction_m=round(fastest.exposed_m - coolest.exposed_m, 1),
        exposure_reduction_pct=round(
            (fastest.exposed_m - coolest.exposed_m) / fastest.exposed_m * 100, 1
        ),
    )
    return RouteResponse(
        routes=[fastest, coolest],
        comparison=comparison,
        meta=RouteMeta(hour=request.hour, shade_preference=request.shade_preference),
    )
