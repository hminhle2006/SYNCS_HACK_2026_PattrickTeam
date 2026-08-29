"""On-demand exposure for a single origin-destination corridor.

The precomputed parquet covers the demo bbox. When a request falls outside it,
this fetches and computes just the corridor between the two points, then merges
the result into the cache on (u, v, key) -- OSM node ids are global, so
separately fetched areas stitch together with no reconciliation.

Two things make this fast enough to sit behind a spinner:

* the three network fetches are independent, so they run concurrently rather
  than one after another;
* the 14 hours run on THREADS, not processes. Shapely 2 releases the GIL
  inside GEOS, so threads give real parallelism -- and for a job this small,
  spawning 8 Windows processes and having each re-import geopandas costs more
  than the geometry itself.
"""

from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor

import geopandas as gpd
import pandas as pd

from backend.config import CACHE_DIR, MAX_HOUR, MIN_HOUR, PROJECTED_CRS
from backend.data import fetch
from backend.geo.exposure import graph_to_segments, segment_exposure
from backend.geo.pipeline import combined_shadows
from backend.geo.solar import hours_of_day, solar_position_series

log = logging.getLogger(__name__)

# Buildings outside the corridor still shade it, so the fetch needs a halo.
# A rigorous halo is height/tan(elevation): 1.8 km for a 200 m tower at the
# 6.4 deg sun of 17:00. That is wider than most walks, so we cap it. 300 m
# captures everything under ~34 m at that angle; taller distant buildings are
# missed at low sun, and that is a stated limitation, not an oversight.
DEFAULT_HALO_M = 300.0


# South of the tropics the sun is always north of vertical around the middle
# of the day and never swings south of the east-west line: across 06:00-19:00
# its azimuth runs 82 deg through 359 deg to 269 deg, so shadows -- which fall
# on the opposite bearing -- land between 89 and 261 deg. East, south, west.
# Never north. So the northern halo can be almost nothing, which is roughly a
# quarter of the fetched area saved at zero cost to accuracy.
NORTH_HALO_M = 25.0


def corridor_bbox(origin: dict, destination: dict, halo_m: float = DEFAULT_HALO_M):
    """(west, south, east, north) around two points, padded asymmetrically.

    Full halo to the south, east and west where shadows actually fall; a token
    margin to the north. See NORTH_HALO_M.
    """
    lats = [origin["lat"], destination["lat"]]
    lons = [origin["lon"], destination["lon"]]
    mid_lat = sum(lats) / 2

    per_deg_lon = 111_320.0 * math.cos(math.radians(mid_lat))
    dlon = halo_m / per_deg_lon
    dlat_south = halo_m / 111_320.0
    dlat_north = NORTH_HALO_M / 111_320.0

    # Latitudes here are negative; "north" is the larger (less negative) value.
    return (
        min(lons) - dlon,
        min(lats) - dlat_south,
        max(lons) + dlon,
        max(lats) + dlat_north,
    )


def _fetch_all(bbox):
    """The three sources are independent; overlap their latency."""
    with ThreadPoolExecutor(max_workers=3) as pool:
        graph_f = pool.submit(fetch.fetch_footpaths, bbox)
        builds_f = pool.submit(fetch.fetch_buildings, bbox)
        trees_f = pool.submit(fetch.fetch_trees, bbox)
        return graph_f.result(), builds_f.result(), trees_f.result()


def compute_corridor(
    origin: dict,
    destination: dict,
    halo_m: float = DEFAULT_HALO_M,
    when=None,
    threads: int = 8,
) -> gpd.GeoDataFrame:
    """Segments with all 14 exposure columns for the corridor between two points.

    All 14 hours are computed, not just the requested one: Lane A's integration
    check rejects nulls in any exposed_frac column, so a partial append would
    fail validation.
    """
    from datetime import date as date_cls

    from backend.config import DEMO_DATE

    when = when or date_cls.fromisoformat(DEMO_DATE)
    bbox = corridor_bbox(origin, destination, halo_m)
    t0 = time.time()

    graph, buildings, trees = _fetch_all(bbox)
    segments = graph_to_segments(graph)
    t_fetch = time.time() - t0
    log.info(
        "[%5.2fs] corridor: %d segments, %d buildings, %d trees",
        t_fetch, len(segments), len(buildings), len(trees),
    )

    stamps = hours_of_day(when, start=MIN_HOUR, end=MAX_HOUR)
    azimuths, elevations = solar_position_series(
        (bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2, stamps
    )

    def one_hour(task):
        hour, az, el = task
        shadows = combined_shadows(buildings, trees, az, el)
        return hour, segment_exposure(segments, shadows).to_numpy()

    tasks = [
        (s.hour, float(a), float(e)) for s, a, e in zip(stamps, azimuths, elevations)
    ]
    with ThreadPoolExecutor(max_workers=threads) as pool:
        for hour, exposure in pool.map(one_hour, tasks):
            segments[f"exposed_frac_{hour:02d}"] = exposure

    log.info(
        "[%5.2fs] corridor done (fetch %.2fs, compute %.2fs)",
        time.time() - t0, t_fetch, time.time() - t0 - t_fetch,
    )
    return segments


def append_to_cache(segments: gpd.GeoDataFrame) -> int:
    """Merge corridor segments into segments.parquet on (u, v, key).

    Existing rows win: the precomputed bbox was built with the full building
    context, whereas a corridor only ever sees its halo.
    """
    path = CACHE_DIR / "segments.parquet"
    if not path.exists():
        segments.to_parquet(path, index=False)
        return len(segments)

    existing = gpd.read_parquet(path)
    before = len(existing)
    merged = pd.concat([existing, segments], ignore_index=True)
    merged = merged.drop_duplicates(subset=["u", "v", "key"], keep="first")
    merged = gpd.GeoDataFrame(merged, geometry="geometry", crs=PROJECTED_CRS)
    merged.to_parquet(path, index=False)
    return len(merged) - before
