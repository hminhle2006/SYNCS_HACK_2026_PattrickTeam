"""Shade-aware walking routes owned by Lane C."""
import logging
from dataclasses import dataclass

import networkx as nx

from backend.config import BBOX, WALKING_SPEED_MPS
from backend.routing.cost import edge_cost
from backend.routing.graph import nearest_node

logger = logging.getLogger("shadeney.routing")

# Forgiveness for clicks just off the bbox edge before snapping.
BBOX_MARGIN_DEG = 0.002


class RoutingError(Exception):
    """Routing failure carrying a stable API error code."""

    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass
class RouteResult:
    coordinates: list[tuple[float, float]]  # (lon, lat), EPSG:4326
    distance_m: float
    duration_s: float
    exposed_m: float
    exposed_frac: float


def route(
    graph: nx.MultiDiGraph,
    origin: tuple[float, float],
    destination: tuple[float, float],
    hour: int,
    shade_preference: float,
    alpha: float | None = None,
) -> tuple[RouteResult, RouteResult]:
    """Compute the fastest and coolest routes between two (lat, lon) points.

    Always returns both: fastest is shade_preference=0, coolest is the
    requested preference. Raises RoutingError for the contract 422 cases.
    alpha overrides the shared ALPHA only for tuning sweeps.
    """
    for label, (lat, lon) in (("origin", origin), ("destination", destination)):
        west, south, east, north = BBOX
        if not (
            west - BBOX_MARGIN_DEG <= lon <= east + BBOX_MARGIN_DEG
            and south - BBOX_MARGIN_DEG <= lat <= north + BBOX_MARGIN_DEG
        ):
            raise RoutingError(
                "OUTSIDE_DEMO_AREA",
                f"The {label} is outside the demo area.",
            )

    source = nearest_node(graph, *origin)
    target = nearest_node(graph, *destination)
    if source == target:
        raise RoutingError(
            "SAME_GRAPH_NODE",
            "The selected locations are too close together to route between.",
        )

    exposure_key = f"exposed_frac_{hour:02d}"
    fastest = _best_route(graph, source, target, exposure_key, 0.0, alpha)
    coolest = _best_route(graph, source, target, exposure_key, shade_preference, alpha)
    if fastest.coordinates == coolest.coordinates:
        logger.warning(
            "coolest route identical to fastest (hour=%s, shade_preference=%s) "
            "- exposure penalty produced no detour",
            hour,
            shade_preference,
        )
    return fastest, coolest


def _best_route(
    graph: nx.MultiDiGraph,
    source: int,
    target: int,
    exposure_key: str,
    shade_preference: float,
    alpha: float | None = None,
) -> RouteResult:
    def weight(u: int, v: int, keyed: dict) -> float:
        return min(
            edge_cost(data["length_m"], data[exposure_key], shade_preference, alpha)
            for data in keyed.values()
        )

    try:
        nodes = nx.shortest_path(graph, source, target, weight=weight)
    except nx.NetworkXNoPath:
        raise RoutingError(
            "NO_PATH",
            "No walking route was found between the selected locations.",
        ) from None

    coordinates: list[tuple[float, float]] = []
    distance_m = 0.0
    exposed_m = 0.0
    for u, v in zip(nodes, nodes[1:]):
        data = min(
            graph[u][v].values(),
            key=lambda d: edge_cost(
                d["length_m"], d[exposure_key], shade_preference, alpha
            ),
        )
        distance_m += data["length_m"]
        exposed_m += data["length_m"] * data[exposure_key]
        coordinates.extend(_oriented(graph, u, data["geometry_lonlat"], coordinates))

    return RouteResult(
        coordinates=coordinates,
        distance_m=distance_m,
        duration_s=distance_m / WALKING_SPEED_MPS,
        exposed_m=exposed_m,
        exposed_frac=exposed_m / distance_m if distance_m else 0.0,
    )


def _oriented(
    graph: nx.MultiDiGraph,
    u: int,
    coords: list[tuple[float, float]],
    accumulated: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Point the edge geometry away from node u and drop the joint duplicate."""
    ux, uy = graph.nodes[u]["x"], graph.nodes[u]["y"]

    def gap(point: tuple[float, float]) -> float:
        return (point[0] - ux) ** 2 + (point[1] - uy) ** 2

    ordered = coords if gap(coords[0]) <= gap(coords[-1]) else coords[::-1]
    if accumulated and accumulated[-1] == ordered[0]:
        return ordered[1:]
    return ordered
