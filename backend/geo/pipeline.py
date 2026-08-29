"""Stage 4: assemble the hourly exposure table.

Produces the two deliverables Lane C and the slide deck depend on:
  backend/cache/segments.parquet      exposed_frac_06 .. exposed_frac_19
  backend/cache/shadows_{HH}.geojson  overlay + validation figure
"""

from __future__ import annotations

import logging
import time
from datetime import date as date_cls
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.ops import unary_union

from backend.config import BBOX, CENTRE_LAT, CENTRE_LON, CRS_METRES, HOUR_END, HOUR_START
from backend.data import fetch
from backend.geo.exposure import graph_to_segments, segment_exposure
from backend.geo.shadows import cast_shadows, tree_shadows
from backend.geo.solar import hours_of_day, solar_position_series

log = logging.getLogger(__name__)
CACHE_DIR = Path(__file__).resolve().parents[1] / "cache"


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
        return gpd.GeoDataFrame({"geometry": []}, crs=CRS_METRES, geometry="geometry")
    return gpd.GeoDataFrame({"geometry": [unary_union(parts)]}, crs=CRS_METRES)


def build_segments_table(
    when: date_cls | None = None,
    bbox=BBOX,
    write_geojson: bool = True,
) -> gpd.GeoDataFrame:
    """Walkable segments with an exposed fraction for every hour 06..19."""
    when = when or date_cls(2026, 8, 29)
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

    stamps = hours_of_day(when, start=HOUR_START, end=HOUR_END)
    azimuths, elevations = solar_position_series(CENTRE_LAT, CENTRE_LON, stamps)

    for stamp, az, el in zip(stamps, azimuths, elevations):
        hh = f"{stamp.hour:02d}"
        shadows = combined_shadows(buildings, trees, float(az), float(el))
        segments[f"exposed_frac_{hh}"] = segment_exposure(segments, shadows)

        if write_geojson and not shadows.empty:
            shadows.to_crs("EPSG:4326").to_file(
                CACHE_DIR / f"shadows_{hh}.geojson", driver="GeoJSON"
            )

        mean = segments[f"exposed_frac_{hh}"].mean()
        log.info(
            "[%5.1fs] %s:00  az %6.1f  el %5.1f  mean exposure %.3f",
            time.time() - t0, hh, az, el, mean,
        )

    out = CACHE_DIR / "segments.parquet"
    segments.to_parquet(out, index=False)
    log.info("[%5.1fs] wrote %s (%d rows)", time.time() - t0, out.name, len(segments))
    return segments


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
