"""Shadow casting.

Everything here works in EPSG:7856 (GDA2020 / MGA zone 56) so that lengths are
in metres. Feed it projected geometry; it will not reproject for you.
"""

from __future__ import annotations

import math

import geopandas as gpd
import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

CRS_METRES = "EPSG:7856"

# Below this the sun is skimming the horizon, shadow_len explodes towards
# infinity, and the honest answer is "everything is in shade".
MIN_ELEVATION_DEG = 3.0


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
        # Vectorised path: GeoSeries.translate handles the whole column at once,
        # then convex_hull is likewise vectorised. Avoids a per-feature Python
        # loop, which is where 14 hours x thousands of buildings falls over.
        moved = gpd.GeoSeries(
            [_translate(g, dx, dy) for g, dx, dy in zip(subset.geometry, dxs, dys)],
            crs=CRS_METRES,
        )
        pairs = gpd.GeoSeries(
            [unary_union([a, b]) for a, b in zip(subset.geometry, moved)], crs=CRS_METRES
        )
        swept = pairs.convex_hull

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
    discs["geometry"] = discs.geometry.buffer(discs[crown_col].fillna(4.0))
    return cast_shadows(discs, azimuth_deg, elevation_deg, height_col=height_col)
