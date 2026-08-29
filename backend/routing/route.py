"""Routing interface owned by Lane C."""
from typing import Any


def route(
    graph: Any,
    origin: tuple[float, float],
    destination: tuple[float, float],
    hour: int,
    shade_preference: float,
) -> Any:
    """Compute fastest and coolest RouteResult values."""
    raise NotImplementedError("Lane C implements routing")
