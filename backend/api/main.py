"""FastAPI app owned by Lane C. Response shapes live in schemas.py only."""
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.mock_routes import build_mock_response
from backend.api.schemas import (
    HealthResponse,
    RouteComparison,
    RouteMeta,
    RouteOption,
    RouteRequest,
    RouteResponse,
)
from backend.config import (
    APP_NAME,
    APP_VERSION,
    CACHE_DIR,
    FRONTEND_ORIGIN,
    MAX_HOUR,
    MIN_HOUR,
)
from backend.routing.route import RouteResult, RoutingError, route

logger = logging.getLogger("shadeney.api")


def _load_shadow_file(hour: int) -> dict | None:
    for name in (f"shadows_{hour:02d}.geojson", f"shadows_{hour}.geojson"):
        path = CACHE_DIR / name
        if path.exists():
            with path.open() as handle:
                return json.load(handle)
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the routing graph and shadow caches once, never per request."""
    from backend.routing.graph import load_graph

    try:
        app.state.graph = load_graph()
    except Exception:
        logger.exception(
            "ROUTING GRAPH FAILED TO LOAD - /api/route is serving MOCK routes"
        )
        app.state.graph = None
    app.state.shadows = {}
    for hour in range(MIN_HOUR, MAX_HOUR + 1):
        collection = _load_shadow_file(hour)
        if collection is not None:
            app.state.shadows[hour] = collection
    if app.state.shadows:
        logger.info("shadow cache loaded for hours %s", sorted(app.state.shadows))
    else:
        logger.info("no shadow geojson files yet; /api/shadows returns 503")
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": code, "message": message}},
    )


@app.exception_handler(RequestValidationError)
def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Map pydantic validation failures onto the stable error codes."""
    locs = {part for error in exc.errors() for part in error.get("loc", ())}
    if "hour" in locs:
        return _error(422, "INVALID_HOUR", "Hour must be an integer between 6 and 19.")
    return _error(
        422, "INVALID_COORDINATES", "Request coordinates or parameters are invalid."
    )


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report process health and whether the generated route cache exists."""
    return HealthResponse(
        cache_ready=(CACHE_DIR / "segments.parquet").exists(),
        version=APP_VERSION,
    )


def _route_option(kind: str, result: RouteResult) -> RouteOption:
    return RouteOption(
        type=kind,
        geometry={"type": "LineString", "coordinates": result.coordinates},
        distance_m=round(result.distance_m, 1),
        duration_s=round(result.duration_s, 1),
        exposed_m=round(result.exposed_m, 1),
        exposed_frac=round(min(max(result.exposed_frac, 0.0), 1.0), 3),
    )


@app.post("/api/route", response_model=RouteResponse)
def route_endpoint(request: RouteRequest) -> RouteResponse | JSONResponse:
    """Compute fastest and coolest walking routes for the requested hour."""
    graph = getattr(app.state, "graph", None)
    if graph is None:
        logger.error("no routing graph loaded; serving MOCK response")
        return build_mock_response(request)
    try:
        fastest, coolest = route(
            graph,
            (request.origin.lat, request.origin.lon),
            (request.destination.lat, request.destination.lon),
            request.hour,
            request.shade_preference,
        )
        reduction_m = fastest.exposed_m - coolest.exposed_m
        reduction_pct = (
            reduction_m / fastest.exposed_m * 100 if fastest.exposed_m else 0.0
        )
        return RouteResponse(
            routes=[_route_option("fastest", fastest), _route_option("coolest", coolest)],
            comparison=RouteComparison(
                extra_distance_m=round(
                    max(coolest.distance_m - fastest.distance_m, 0.0), 1
                ),
                extra_duration_s=round(
                    max(coolest.duration_s - fastest.duration_s, 0.0), 1
                ),
                exposure_reduction_m=round(reduction_m, 1),
                exposure_reduction_pct=round(reduction_pct, 1),
            ),
            meta=RouteMeta(
                hour=request.hour, shade_preference=request.shade_preference
            ),
        )
    except RoutingError as exc:
        return _error(exc.status_code, exc.code, exc.message)
    except Exception:
        logger.exception("route handler failed")
        return _error(
            500,
            "INTERNAL_ROUTING_ERROR",
            "Routing failed unexpectedly. Please try again.",
        )


@app.get("/api/shadows")
def shadows(hour: int = Query(ge=MIN_HOUR, le=MAX_HOUR)) -> JSONResponse:
    """Serve the cached shadow FeatureCollection for one supported hour."""
    cache: dict = getattr(app.state, "shadows", {})
    collection = cache.get(hour)
    if collection is None:
        collection = _load_shadow_file(hour)
        if collection is not None:
            cache[hour] = collection
    if collection is None:
        return _error(
            503,
            "CACHE_NOT_READY",
            f"Shadow data for hour {hour} has not been generated yet.",
        )
    return JSONResponse(content=collection)
