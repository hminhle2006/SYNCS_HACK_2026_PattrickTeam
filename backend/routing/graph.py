"""Routing graph construction owned by Lane C.

Both data sources normalize to one edge schema so the swap from the
stand-in to Lane B's segments.parquet is a data change, not a code change:

- node attrs: ``x`` (lon), ``y`` (lat) in EPSG:4326
- edge attrs: ``length_m``, ``exposed_frac_06``..``exposed_frac_19``, and
  ``geometry_lonlat`` (list of (lon, lat) pairs running u -> v)
"""
import logging
import math
import pickle
import random

import networkx as nx
import numpy as np

from backend.config import BBOX, CACHE_DIR, MAX_HOUR, MIN_HOUR, PROJECTED_CRS

logger = logging.getLogger("shadeney.routing")

HOURS = range(MIN_HOUR, MAX_HOUR + 1)
EXPOSURE_COLUMNS = [f"exposed_frac_{hour:02d}" for hour in HOURS]
SEGMENTS_PATH = CACHE_DIR / "segments.parquet"
STANDIN_PATH = CACHE_DIR / "standin_graph.pkl"
SYNTHETIC_PATH = CACHE_DIR / "synthetic_graph.pkl"
STANDIN_SEED = 20260829


def build_graph(segments) -> nx.MultiDiGraph:
    """Build the walking graph from a segments GeoDataFrame (EPSG:7856).

    Nodes are OSM u/v ids. Every edge carries length_m and exposed_frac_06..19.
    """
    required = {"u", "v", "key", "geometry", "length_m", *EXPOSURE_COLUMNS}
    missing = required - set(segments.columns)
    if missing:
        raise ValueError(f"segments cache is missing columns: {sorted(missing)}")

    lonlat = segments.to_crs("EPSG:4326") if segments.crs else segments
    if segments.crs and segments.crs.to_string() != PROJECTED_CRS:
        logger.warning("segments CRS is %s, expected %s", segments.crs, PROJECTED_CRS)

    graph = nx.MultiDiGraph(source="segments")
    for row in lonlat.itertuples(index=False):
        coords = [(float(x), float(y)) for x, y in row.geometry.coords]
        u, v, key = int(row.u), int(row.v), int(row.key)
        attrs = {
            "length_m": float(row.length_m),
            "geometry_lonlat": coords,
        }
        for column in EXPOSURE_COLUMNS:
            attrs[column] = float(getattr(row, column))
        graph.add_edge(u, v, key=key, **attrs)
        graph.nodes[u].setdefault("x", coords[0][0])
        graph.nodes[u].setdefault("y", coords[0][1])
        graph.nodes[v].setdefault("x", coords[-1][0])
        graph.nodes[v].setdefault("y", coords[-1][1])
    return graph


def _standin_exposure(u: int, v: int, key: int, hour: int) -> float:
    """Reproducible fake exposure in [0.2, 0.9], varying by edge and hour."""
    return random.Random(f"{STANDIN_SEED}:{u}:{v}:{key}:{hour}").uniform(0.2, 0.9)


def build_standin_graph() -> nx.MultiDiGraph:
    """Download the OSM walk graph and attach seeded random exposures.

    Stand-in until Lane B delivers segments.parquet; the swap is handled
    entirely by load_graph preferring the parquet when it exists.
    """
    import osmnx as ox

    walk = ox.graph_from_bbox(bbox=BBOX, network_type="walk")
    graph = nx.MultiDiGraph(source="standin")
    for u, v, key, data in walk.edges(keys=True, data=True):
        if "geometry" in data:
            coords = [(float(x), float(y)) for x, y in data["geometry"].coords]
        else:
            coords = [
                (float(walk.nodes[u]["x"]), float(walk.nodes[u]["y"])),
                (float(walk.nodes[v]["x"]), float(walk.nodes[v]["y"])),
            ]
        attrs = {
            "length_m": float(data["length"]),
            "geometry_lonlat": coords,
        }
        for hour in HOURS:
            attrs[f"exposed_frac_{hour:02d}"] = _standin_exposure(u, v, key, hour)
        graph.add_edge(int(u), int(v), key=int(key), **attrs)
    for node, data in walk.nodes(data=True):
        if int(node) in graph:
            graph.nodes[int(node)]["x"] = float(data["x"])
            graph.nodes[int(node)]["y"] = float(data["y"])
    return graph


def build_synthetic_graph() -> nx.MultiDiGraph:
    """Seeded street-like grid over the demo bbox; no network required.

    Last-resort stand-in for environments where Overpass is unreachable.
    Same schema as the other sources, so routing code cannot tell.
    """
    rng = random.Random(STANDIN_SEED)
    west, south, east, north = BBOX
    cols, rows = 28, 24
    dlon = (east - west) / (cols - 1)
    dlat = (north - south) / (rows - 1)

    nodes: dict[tuple[int, int], tuple[int, float, float]] = {}
    for r in range(rows):
        for c in range(cols):
            lon = west + c * dlon + rng.uniform(-0.25, 0.25) * dlon
            lat = south + r * dlat + rng.uniform(-0.25, 0.25) * dlat
            nodes[(r, c)] = (r * 1000 + c, lon, lat)

    graph = nx.MultiDiGraph(source="synthetic")
    for (r, c), (u, lon_u, lat_u) in nodes.items():
        for r2, c2 in ((r, c + 1), (r + 1, c)):
            if (r2, c2) not in nodes or rng.random() < 0.08:
                continue
            v, lon_v, lat_v = nodes[(r2, c2)]
            coords = [(lon_u, lat_u), (lon_v, lat_v)]
            attrs = {"length_m": _haversine_m(coords[0], coords[1])}
            for hour in HOURS:
                attrs[f"exposed_frac_{hour:02d}"] = _standin_exposure(u, v, 0, hour)
            graph.add_edge(u, v, key=0, geometry_lonlat=coords, **attrs)
            graph.add_edge(v, u, key=0, geometry_lonlat=coords[::-1], **attrs)
            for node, lon, lat in ((u, lon_u, lat_u), (v, lon_v, lat_v)):
                graph.nodes[node]["x"] = lon
                graph.nodes[node]["y"] = lat

    largest = max(nx.weakly_connected_components(graph), key=len)
    return graph.subgraph(largest).copy()


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def load_graph() -> nx.MultiDiGraph:
    """Load the routing graph once at startup, preferring real data.

    Order: segments.parquet -> cached OSM stand-in -> downloaded OSM
    stand-in -> cached-or-built synthetic grid. Both stand-ins cache a
    pickle so later startups skip the download attempt; delete the
    synthetic pickle to retry the OSM download once network is available.
    """
    if SEGMENTS_PATH.exists():
        import geopandas as gpd

        graph = build_graph(gpd.read_parquet(SEGMENTS_PATH))
        logger.info("routing graph loaded from segments.parquet: %s", _describe(graph))
        return graph
    for path, label in ((STANDIN_PATH, "OSM stand-in"), (SYNTHETIC_PATH, "synthetic")):
        if path.exists():
            with path.open("rb") as handle:
                graph = pickle.load(handle)
            logger.info("routing graph from cached %s: %s", label, _describe(graph))
            return graph
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        graph = build_standin_graph()
        with STANDIN_PATH.open("wb") as handle:
            pickle.dump(graph, handle)
        logger.info("stand-in routing graph downloaded: %s", _describe(graph))
        return graph
    except Exception:
        logger.exception(
            "OSM stand-in download failed; using SYNTHETIC grid graph. "
            "Routes are fake street geometry until segments.parquet arrives."
        )
    graph = build_synthetic_graph()
    with SYNTHETIC_PATH.open("wb") as handle:
        pickle.dump(graph, handle)
    logger.info("synthetic routing graph built: %s", _describe(graph))
    return graph


def _describe(graph: nx.MultiDiGraph) -> str:
    return (
        f"{graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges "
        f"(source={graph.graph.get('source', 'unknown')})"
    )


def nearest_node(graph: nx.MultiDiGraph, lat: float, lon: float) -> int:
    """Snap a point to the nearest graph node (equirectangular metric)."""
    snap = graph.graph.get("_snap")
    if snap is None:
        ids = np.array(list(graph.nodes), dtype=np.int64)
        lons = np.array([graph.nodes[n]["x"] for n in ids], dtype=np.float64)
        lats = np.array([graph.nodes[n]["y"] for n in ids], dtype=np.float64)
        snap = graph.graph["_snap"] = (ids, lons, lats)
    ids, lons, lats = snap
    scale = math.cos(math.radians(lat))
    distances = ((lons - lon) * scale) ** 2 + (lats - lat) ** 2
    return int(ids[int(np.argmin(distances))])
