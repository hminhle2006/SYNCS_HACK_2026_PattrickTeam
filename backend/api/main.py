"""FastAPI scaffold. Lane C replaces route internals without changing schemas."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.schemas import HealthResponse
from backend.config import APP_NAME, APP_VERSION, CACHE_DIR, FRONTEND_ORIGIN

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
