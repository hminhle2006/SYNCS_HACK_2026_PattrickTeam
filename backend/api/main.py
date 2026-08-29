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
    UVDoseResponse,
    UVIndex,
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


def _tree_feature_collection(
    west: float, south: float, east: float, north: float
) -> dict:
    """Return City of Sydney tree points visible in the requested map bounds.

    The generated cache already contains the complete City of Sydney tree
    dataset used by the shadow model.  Reading it avoids a live ArcGIS request
    when the frontend needs to visualise the canopy.
    """
    from backend.config import BBOX, GEOGRAPHIC_CRS
    from backend.data.fetch import fetch_trees

    trees = fetch_trees(BBOX)
    if trees.empty:
        return {"type": "FeatureCollection", "features": []}

    visible = trees.to_crs(GEOGRAPHIC_CRS).cx[west:east, south:north]
    features = []
    for row in visible.itertuples():
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "crown_radius_m": round(float(row.crown_radius_m), 1),
                    "height_m": round(float(row.height_m), 1),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [row.geometry.x, row.geometry.y],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


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
# Vite moves to the next free port when 5173 is taken -- by a stale dev server,
# another project, anything. With an exact-match allowlist every request from
# the new port is then rejected as a CORS violation, and the frontend silently
# falls back to hardcoded demo numbers: the app looks like it works while
# showing fiction. Matching any loopback port removes that whole failure mode.
#
# Demoing on a phone hits the same wall one step further out: the handset loads
# the app over the local network, so its origin is the laptop's LAN address and
# not loopback at all. Private ranges are therefore allowed too. Starlette
# fullmatches this pattern, so it stays confined to addresses that are only
# reachable from the same network -- no public origin can satisfy it.
LOCALHOST_ORIGIN_PATTERN = (
    r"http://("
    r"localhost|127\.0\.0\.1|\[::1\]"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_origin_regex=LOCALHOST_ORIGIN_PATTERN,
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


def _uv_reading(hour: int) -> UVIndex:
    from backend.data.uv import uv_index_for_hour

    reading = uv_index_for_hour(hour)
    return UVIndex(
        hour=hour,
        uv_index=round(max(reading.index, 0.0), 1),
        source=reading.source,
        is_live=reading.is_live,
        observed_at=reading.observed_at,
    )


@app.get("/api/uv", response_model=UVIndex)
def uv(hour: int = Query(ge=MIN_HOUR, le=MAX_HOUR)) -> UVIndex | JSONResponse:
    """UV index for the displayed hour: live ARPANSA now, modelled otherwise."""
    try:
        return _uv_reading(hour)
    except Exception:
        logger.exception("uv handler failed")
        return _error(
            500, "INTERNAL_ROUTING_ERROR", "UV index lookup failed unexpectedly."
        )


@app.post("/api/uv-dose", response_model=UVDoseResponse)
def uv_dose(request: RouteRequest) -> UVDoseResponse | JSONResponse:
    """Honest UV dose for the fastest and coolest routes of this request.

    Shade removes only the direct beam; the diffuse skylight term stays, so
    the UV reduction is deliberately smaller than the sun-exposure reduction.
    """
    from backend.geo.dose import compare_doses, route_uv_dose

    try:
        graph = getattr(app.state, "graph", None)
        if graph is None:
            logger.error("no routing graph loaded; UV dose uses MOCK routes")
            fastest, coolest = build_mock_response(request).routes
        else:
            fastest, coolest = route(
                graph,
                (request.origin.lat, request.origin.lon),
                (request.destination.lat, request.destination.lon),
                request.hour,
                request.shade_preference,
            )
        reading = _uv_reading(request.hour)
        numbers = compare_doses(
            route_uv_dose(reading.uv_index, fastest.duration_s, fastest.exposed_frac),
            route_uv_dose(reading.uv_index, coolest.duration_s, coolest.exposed_frac),
        )
        return UVDoseResponse(
            uv=reading,
            fastest_sed=numbers["fastest_sed"],
            coolest_sed=numbers["coolest_sed"],
            uv_reduction_sed=numbers["uv_reduction_sed"],
            uv_reduction_pct=numbers["uv_reduction_pct"],
            fastest_minutes_to_burn=numbers["fastest_minutes_to_burn"],
            coolest_minutes_to_burn=numbers["coolest_minutes_to_burn"],
            meta=RouteMeta(
                hour=request.hour, shade_preference=request.shade_preference
            ),
        )
    except RoutingError as exc:
        return _error(exc.status_code, exc.code, exc.message)
    except Exception:
        logger.exception("uv-dose handler failed")
        return _error(
            500, "INTERNAL_ROUTING_ERROR", "UV dose computation failed unexpectedly."
        )


@app.get("/api/trees")
def get_trees(
    west: float, south: float, east: float, north: float
) -> dict:
    """Street trees as GeoJSON points within a bbox.

    The frontend renders these as canopy pools sized by crown_radius_m, so both
    fields are returned per tree. Reads the cached City of Sydney extract that
    already backs the shadow model -- no network call, no recomputation.
    """
    import geopandas as gpd

    from backend.config import BBOX
    from backend.data import fetch

    try:
        trees = fetch.fetch_trees(BBOX)
    except Exception:
        logger.exception("tree cache unavailable")
        return {"type": "FeatureCollection", "features": []}

    if trees.empty:
        return {"type": "FeatureCollection", "features": []}

    wgs = trees.to_crs("EPSG:4326")
    clipped = wgs.cx[west:east, south:north]

    features = [
        {
            "type": "Feature",
            "properties": {
                "crown_radius_m": float(row.crown_radius_m),
                "height_m": float(row.height_m),
            },
            "geometry": {
                "type": "Point",
                "coordinates": [round(row.geometry.x, 6), round(row.geometry.y, 6)],
            },
        }
        for row in clipped.itertuples()
    ]
    logger.info("served %d trees for bbox", len(features))
    return {"type": "FeatureCollection", "features": features}


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


@app.get("/api/trees")
def trees(
    west: float = Query(ge=-180.0, le=180.0),
    south: float = Query(ge=-90.0, le=90.0),
    east: float = Query(ge=-180.0, le=180.0),
    north: float = Query(ge=-90.0, le=90.0),
) -> JSONResponse:
    """Serve cached City of Sydney canopy points for the current map view."""
    if west >= east or south >= north:
        return _error(422, "INVALID_COORDINATES", "Map bounds are invalid.")
    try:
        return JSONResponse(content=_tree_feature_collection(west, south, east, north))
    except Exception:
        logger.exception("tree cache could not be read")
        return _error(
            503,
            "CACHE_NOT_READY",
            "Tree data has not been generated yet.",
        )
