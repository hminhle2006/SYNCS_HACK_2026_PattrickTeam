"""Shadow casting.

Everything here works in EPSG:7856 (GDA2020 / MGA zone 56) so that lengths are
in metres. Feed it projected geometry; it will not reproject for you.
"""

from __future__ import annotations

import math

import geopandas as gpd
import numpy as np
import shapely
import shapely.affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from backend.config import PROJECTED_CRS as CRS_METRES  # Lane A owns the value

# Below this the sun is skimming the horizon, shadow_len explodes towards
# infinity, and the honest answer is "everything is in shade".
MIN_ELEVATION_DEG = 3.0

# Canopy discs are approximated with 16-gons (quad_segs=4). Visually
# identical at map scale, a quarter of the vertices, and every downstream
# union is proportionally cheaper.
DEFAULT_CROWN_RADIUS_M = 4.0


def shadow_offset(height_m, elevation_deg: float, azimuth_deg: float):
    """Translation vector (dx, dy) in metres for a feature of the given height.

    The shadow falls opposite the sun, i.e. along bearing azimuth + 180.
    Bearings are clockwise from north, so sin drives easting (dx) and cos
    drives northing (dy). Swapping these is the classic silent killer.
    """
    length = np.asarray(height_m, dtype=float) / math.tan(math.radians(elevation_deg))
    bearing = math.radians(azimuth_deg + 180.0)
    return length * math.sin(bearing), length * math.cos(bearing)


def _swept(geom, dx: float, dy: float, exact: bool):
    """Region covered as `geom` slides along (dx, dy).

    Mathematically this is the Minkowski sum of the polygon with the
    translation segment. Two ways to get it:

    hull  -- union(original, translated).convex_hull. Exact for convex
             footprints, fast, and what the lane brief specifies. It
             OVER-estimates concave footprints: an L-shaped building has its
             notch filled in, so you claim shade that is not there.
    exact -- additionally sweeps every exterior edge. Correct for any simple
             polygon. Slower; worth it for the validation figure.
    """
    moved = _translate(geom, dx, dy)
    if not exact:
        return unary_union([geom, moved]).convex_hull

    parts = [geom, moved]
    for poly in getattr(geom, "geoms", [geom]):
        coords = list(poly.exterior.coords)
        for (x0, y0), (x1, y1) in zip(coords[:-1], coords[1:]):
            parts.append(Polygon([(x0, y0), (x1, y1), (x1 + dx, y1 + dy), (x0 + dx, y0 + dy)]))
    return unary_union(parts)


def _translate(geom, dx: float, dy: float):
    from shapely.affinity import translate

    return translate(geom, xoff=dx, yoff=dy)


def cast_shadows(
    footprints: gpd.GeoDataFrame,
    azimuth_deg: float,
    elevation_deg: float,
    height_col: str = "height_m",
    exact: bool = False,
) -> gpd.GeoDataFrame:
    """Dissolved shadow polygons for a set of footprints.

    Returns a single-row GeoDataFrame holding the dissolved multipolygon, or
    the full bbox when the sun is at or below the horizon.
    """
    if footprints.crs is None or footprints.crs.to_string() != CRS_METRES:
        raise ValueError(f"footprints must be in {CRS_METRES}, got {footprints.crs}")

    if elevation_deg <= MIN_ELEVATION_DEG:
        return gpd.GeoDataFrame(
            {"geometry": [box(*footprints.total_bounds)]}, crs=CRS_METRES
        )

    heights = footprints[height_col].to_numpy(dtype=float)
    valid = np.isfinite(heights) & (heights > 0)
    if not valid.any():
        return gpd.GeoDataFrame({"geometry": []}, crs=CRS_METRES, geometry="geometry")

    subset = footprints.loc[valid]
    dxs, dys = shadow_offset(heights[valid], elevation_deg, azimuth_deg)

    if exact:
        swept = [_swept(g, dx, dy) for g, dx, dy in zip(subset.geometry, dxs, dys)]
    else:
        # shapely 2 is vectorised over numpy arrays of geometries, so union
        # and convex_hull each run once in C across the whole column rather
        # than once per feature in Python. Across 14 hours and thousands of
        # footprints that is the difference between minutes and tens of them.
        geoms = np.asarray(subset.geometry.values)
        moved = np.array(
            [shapely.affinity.translate(g, xoff=dx, yoff=dy)
             for g, dx, dy in zip(geoms, dxs, dys)],
            dtype=object,
        )
        swept = shapely.convex_hull(shapely.union(geoms, moved))

    dissolved = unary_union(list(swept))
    return gpd.GeoDataFrame({"geometry": [dissolved]}, crs=CRS_METRES)


def tree_shadows(
    trees: gpd.GeoDataFrame,
    azimuth_deg: float,
    elevation_deg: float,
    crown_col: str = "crown_radius_m",
    height_col: str = "height_m",
) -> gpd.GeoDataFrame:
    """Same sweep, applied to the canopy disc.

    Canopy is treated as opaque for v1. A partial-shade weight (~0.7 for trees
    vs 1.0 for buildings) is a sound refinement, but only once the whole
    pipeline runs end to end.
    """
    if trees.empty:
        return gpd.GeoDataFrame({"geometry": []}, crs=CRS_METRES, geometry="geometry")

    discs = trees.copy()
    # resolution=4 gives a 16-gon. GeoSeries.buffer already forwards this to
    # shapely as quad_segs, so passing quad_segs directly collides with it.
    discs["geometry"] = discs.geometry.buffer(
        discs[crown_col].fillna(DEFAULT_CROWN_RADIUS_M), resolution=4
    )
    return cast_shadows(discs, azimuth_deg, elevation_deg, height_col=height_col)
