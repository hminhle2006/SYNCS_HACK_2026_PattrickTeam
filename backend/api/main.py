"""FastAPI scaffold. Lane C replaces route internals without changing schemas."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.mock_routes import build_mock_response
from backend.api.schemas import HealthResponse, RouteRequest, RouteResponse
from backend.config import APP_NAME, APP_VERSION, CACHE_DIR, FRONTEND_ORIGIN

logger = logging.getLogger("shadeney.api")

app = FastAPI(title=APP_NAME, version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Report process health and whether the generated route cache exists."""
    return HealthResponse(
        cache_ready=(CACHE_DIR / "segments.parquet").exists(),
        version=APP_VERSION,
    )


@app.post("/api/route", response_model=RouteResponse)
def route(request: RouteRequest) -> RouteResponse | JSONResponse:
    """Mock implementation: hard-coded demo-pair routes, real contract shape."""
    try:
        return build_mock_response(request)
    except Exception:
        logger.exception("route handler failed")
        return JSONResponse(
            status_code=500,
            content={
                "detail": {
                    "code": "INTERNAL_ROUTING_ERROR",
                    "message": "Routing failed unexpectedly. Please try again.",
                }
            },
        )
