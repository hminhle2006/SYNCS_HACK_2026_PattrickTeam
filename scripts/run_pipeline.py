#!/usr/bin/env python3
"""Cold-start integration check for shared Shadeney contracts and cache files."""
from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.config import CACHE_DIR, MAX_HOUR, MIN_HOUR, PROJECTED_CRS  # noqa: E402


def fail(message: str) -> None:
    print(f"[FAIL] {message}")
    raise SystemExit(1)


def passed(message: str) -> None:
    print(f"[PASS] {message}")


def validate_cache() -> bool:
    path = CACHE_DIR / "segments.parquet"
    if not path.exists():
        print("[WAIT] segments.parquet not present; Lane B has not handed off real data")
        return False

    try:
        import geopandas as gpd
    except ImportError as exc:
        fail(f"geopandas is required to inspect the cache: {exc}")

    segments = gpd.read_parquet(path)
    exposure_columns = [f"exposed_frac_{hour:02d}" for hour in range(MIN_HOUR, MAX_HOUR + 1)]
    required = {"u", "v", "key", "geometry", "length_m", *exposure_columns}
    missing = sorted(required.difference(segments.columns))
    if missing:
        fail(f"segments.parquet is missing columns: {', '.join(missing)}")
    if segments.empty:
        fail("segments.parquet contains no walking segments")
    if segments.crs is None or segments.crs.to_string().upper() != PROJECTED_CRS:
        fail(f"cache CRS must be {PROJECTED_CRS}, found {segments.crs}")
    if (segments["length_m"] <= 0).any():
        fail("length_m must be positive for every segment")
    for column in exposure_columns:
        if segments[column].isna().any() or not segments[column].between(0.0, 1.0).all():
            fail(f"{column} must contain non-null values in [0, 1]")

    passed(f"cache schema valid: {len(segments):,} directed edges")
    for hour in (9, 14, 17):
        print(f"       mean exposure {hour:02d}:00 = {segments[f'exposed_frac_{hour:02d}'].mean():.3f}")
    return True


def main() -> None:
    print("SHADENEY INTEGRATION CHECK")
    if sys.version_info[:2] != (3, 11):
        print(f"[WARN] expected Python 3.11, running {sys.version.split()[0]}")
    else:
        passed(f"Python {sys.version.split()[0]}")

    from backend.api.schemas import RouteRequest
    from backend.config import DEMO_DESTINATION, DEMO_ORIGIN, DEMO_TIME

    RouteRequest(
        origin=DEMO_ORIGIN,
        destination=DEMO_DESTINATION,
        hour=DEMO_TIME,
        shade_preference=0.8,
    )
    passed("API request contract validates the configured demo journey")

    cache_ready = validate_cache()
    if cache_ready:
        print("[NEXT] Lane C integration can build and benchmark the real graph")
    else:
        print("[PASS] scaffold is ready; cache-dependent checks deferred")


if __name__ == "__main__":
    main()
