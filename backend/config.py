"""Shared Shadeney configuration. Lane A owns this file."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "backend" / "cache"

APP_NAME = "Shadeney"
APP_VERSION = "0.1.0"
TIMEZONE = "Australia/Sydney"
DEMO_DATE = "2026-08-29"

# Bounding-box order: west, south, east, north.
BBOX = (151.1690, -33.9030, 151.2110, -33.8660)

# Demo journey: Redfern Station area to the University of Sydney campus.
DEMO_ORIGIN = {"lat": -33.8913, "lon": 151.1980}
DEMO_DESTINATION = {"lat": -33.8870, "lon": 151.1902}
DEMO_TIME = 14

GEOGRAPHIC_CRS = "EPSG:4326"
PROJECTED_CRS = "EPSG:7856"
MIN_HOUR = 6
MAX_HOUR = 19
WALKING_SPEED_MPS = 1.35
ALPHA = 3.0
FRONTEND_ORIGIN = "http://localhost:5173"
