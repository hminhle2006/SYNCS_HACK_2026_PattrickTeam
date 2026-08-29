"""Thin the shadow overlays down to something a browser can actually draw.

The full-fidelity layer is ~3,750 polygons and 8-11 MB per hour. MapLibre
stalls for tens of seconds on that, so the overlay never appears -- the data is
correct and simply too heavy to render.

Simplifying vertices is not enough: it cuts bytes but leaves the polygon count
unchanged, and the count is what costs. Dropping negligible slivers is what
matters. At a 250 m^2 floor -- a patch smaller than 16 m square, invisible at
map zoom -- 98.4% of the shaded AREA survives on 27% of the polygons.

The routing numbers are never computed from this. Exposure comes from the
full-fidelity geometry in the parquet; this is display only.
"""

from __future__ import annotations

import logging
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon

log = logging.getLogger(__name__)

CRS_METRES = "EPSG:7856"
DISPLAY_TOLERANCE_M = 2.0
MIN_POLYGON_AREA_M2 = 250.0


def thin_for_display(
    shadows: gpd.GeoDataFrame,
    tolerance_m: float = DISPLAY_TOLERANCE_M,
    min_area_m2: float = MIN_POLYGON_AREA_M2,
) -> gpd.GeoDataFrame:
    """Drop slivers and simplify what remains. Input must be in metres."""
    kept = []
    dropped = 0
    for geom in shadows.geometry:
        if geom is None or geom.is_empty:
            continue
        for part in getattr(geom, "geoms", [geom]):
            if part.area >= min_area_m2:
                kept.append(part)
            else:
                dropped += 1

    if not kept:
        return gpd.GeoDataFrame({"geometry": []}, crs=CRS_METRES, geometry="geometry")

    merged = MultiPolygon(kept).simplify(tolerance_m).buffer(0)
    log.info("display layer: kept %d polygons, dropped %d slivers", len(kept), dropped)
    return gpd.GeoDataFrame({"geometry": [merged]}, crs=CRS_METRES)


def rewrite_geojson(path: Path) -> tuple[int, int]:
    """Rewrite one shadows_HH.geojson in place as a display layer."""
    before = path.stat().st_size
    gdf = gpd.read_file(path).to_crs(CRS_METRES)
    thinned = thin_for_display(gdf)
    if thinned.empty:
        return before, before
    thinned.to_crs("EPSG:4326").to_file(path, driver="GeoJSON")
    return before, path.stat().st_size
