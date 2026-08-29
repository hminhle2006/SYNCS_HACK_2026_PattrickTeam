"""Stage 4: assemble the hourly exposure table.

Produces the two deliverables Lane C and the slide deck depend on:
  backend/cache/segments.parquet      exposed_frac_06 .. exposed_frac_19
  backend/cache/shadows_{HH}.geojson  overlay + validation figure
"""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import date as date_cls
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from backend.config import (
    BBOX, CACHE_DIR, DEMO_DATE, MAX_HOUR, MIN_HOUR, PROJECTED_CRS,
)
from backend.data import fetch
from backend.geo.exposure import graph_to_segments, segment_exposure
from backend.geo.shadows import cast_shadows, tree_shadows
from backend.geo.solar import hours_of_day, solar_position_series

log = logging.getLogger(__name__)
# Centre of the bbox, for solar position. The study area is small enough
# that one position for the whole box sits well inside the error the
# height data already carries.
CENTRE_LON = (BBOX[0] + BBOX[2]) / 2.0
CENTRE_LAT = (BBOX[1] + BBOX[3]) / 2.0


def combined_shadows(buildings, trees, azimuth_deg: float, elevation_deg: float):
    """Building and canopy shadows, dissolved together.

    Canopy is opaque for v1. Keeping the two sources separate would let you
    weight tree shade at ~0.7 against 1.0 for buildings -- a sound refinement,
    but only once the whole pipeline runs end to end.
    """
    parts = []
    b = cast_shadows(buildings, azimuth_deg, elevation_deg)
    if not b.empty:
        parts.extend(b.geometry)
    if trees is not None and not trees.empty:
        t = tree_shadows(trees, azimuth_deg, elevation_deg)
        if not t.empty:
            parts.extend(t.geometry)

    if not parts:
        return gpd.GeoDataFrame({"geometry": []}, crs=PROJECTED_CRS, geometry="geometry")
    return gpd.GeoDataFrame({"geometry": [unary_union(parts)]}, crs=PROJECTED_CRS)


# --- parallel execution -----------------------------------------------------
# The 14 hours share no state: each one casts its own shadows and measures its
# own segments. Running them sequentially leaves ~15 of 16 cores idle for
# twenty minutes. Windows spawns rather than forks, so workers cannot inherit
# the loaded GeoDataFrames -- each loads them once from the disk cache in its
# initialiser, then handles however many hours it is given.

_WORKER: dict = {}


def _init_worker(bbox) -> None:
    import warnings

    warnings.filterwarnings("ignore")
    _WORKER["buildings"] = fetch.fetch_buildings(bbox)
    _WORKER["trees"] = fetch.fetch_trees(bbox)
    _WORKER["segments"] = graph_to_segments(fetch.fetch_footpaths(bbox))


def _compute_hour(task):
    """One hour of work. Returns (hour, exposure array, azimuth, elevation)."""
    hour, azimuth, elevation, write_geojson = task
    shadows = combined_shadows(
        _WORKER["buildings"], _WORKER["trees"], azimuth, elevation
    )
    exposure = segment_exposure(_WORKER["segments"], shadows)

    if write_geojson and not shadows.empty:
        shadows.to_crs("EPSG:4326").to_file(
            CACHE_DIR / f"shadows_{hour:02d}.geojson", driver="GeoJSON"
        )
    return hour, exposure.to_numpy(), azimuth, elevation


def _default_workers() -> int:
    """Half the logical cores, capped at the number of hours.

    Each worker holds its own copy of the buildings, trees and segment
    tables -- a few hundred MB apiece -- so this trades some parallelism for
    not thrashing swap on a 16 GB laptop.
    """
    cores = os.cpu_count() or 4
    return max(1, min(cores // 2, MAX_HOUR - MIN_HOUR + 1))


def build_segments_table(
    when: date_cls | None = None,
    bbox=BBOX,
    write_geojson: bool = True,
    workers: int | None = None,
) -> gpd.GeoDataFrame:
    """Walkable segments with an exposed fraction for every hour 06..19."""
    when = when or date_cls.fromisoformat(DEMO_DATE)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    graph = fetch.fetch_footpaths(bbox)
    buildings = fetch.fetch_buildings(bbox)
    trees = fetch.fetch_trees(bbox)
    segments = graph_to_segments(graph)
    log.info(
        "[%5.1fs] %d segments, %d buildings, %d trees",
        time.time() - t0, len(segments), len(buildings), len(trees),
    )

    stamps = hours_of_day(when, start=MIN_HOUR, end=MAX_HOUR)
    azimuths, elevations = solar_position_series(CENTRE_LAT, CENTRE_LON, stamps)
    tasks = [
        (stamp.hour, float(az), float(el), write_geojson)
        for stamp, az, el in zip(stamps, azimuths, elevations)
    ]

    if workers is None:
        workers = _default_workers()

    if workers <= 1:
        results = [_run_hour_inline(buildings, trees, segments, task) for task in tasks]
    else:
        log.info("dispatching %d hours across %d workers", len(tasks), workers)
        with ProcessPoolExecutor(
            max_workers=workers, initializer=_init_worker, initargs=(bbox,)
        ) as pool:
            results = list(pool.map(_compute_hour, tasks))

    # Hours come back in completion order; sort so the columns read 06..19.
    for hour, exposure, az, el in sorted(results):
        segments[f"exposed_frac_{hour:02d}"] = exposure
        log.info(
            "[%5.1fs] %02d:00  az %6.1f  el %5.1f  mean exposure %.3f",
            time.time() - t0, hour, az, el, float(exposure.mean()),
        )

    out = CACHE_DIR / "segments.parquet"
    segments.to_parquet(out, index=False)
    log.info("[%5.1fs] wrote %s (%d rows)", time.time() - t0, out.name, len(segments))
    return segments


def _run_hour_inline(buildings, trees, segments, task):
    """Single-process equivalent of _compute_hour, for workers=1 debugging."""
    hour, azimuth, elevation, write_geojson = task
    shadows = combined_shadows(buildings, trees, azimuth, elevation)
    exposure = segment_exposure(segments, shadows)
    if write_geojson and not shadows.empty:
        shadows.to_crs("EPSG:4326").to_file(
            CACHE_DIR / f"shadows_{hour:02d}.geojson", driver="GeoJSON"
        )
    return hour, exposure.to_numpy(), azimuth, elevation


def handoff_readout(segments: gpd.GeoDataFrame) -> str:
    """Sanity numbers for Lane C.

    If 09:00, 14:00 and 17:00 are not meaningfully different, the solar
    geometry is wrong -- not their routing.
    """
    lines = ["Mean exposure by hour (Lane C handoff):"]
    for hh in ("09", "14", "17"):
        col = f"exposed_frac_{hh}"
        if col in segments.columns:
            lines.append(f"  {hh}:00   {segments[col].mean():.3f}")
    spread = [segments[f"exposed_frac_{h}"].mean() for h in ("09", "14", "17")
              if f"exposed_frac_{h}" in segments.columns]
    if len(spread) == 3 and max(spread) - min(spread) < 0.02:
        lines.append("  WARNING: these are nearly identical. Suspect solar geometry.")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    import warnings

    warnings.filterwarnings("ignore")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)

    from backend.data import fetch as _fetch

    table = build_segments_table()
    print()
    print(handoff_readout(table), flush=True)
    print()
    print(_fetch.fallback_report(), flush=True)
