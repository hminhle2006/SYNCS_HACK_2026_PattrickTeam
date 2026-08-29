"""Shadow-casting interfaces owned by Lane B."""
from typing import Any


def cast_shadows(footprints: Any, azimuth_deg: float, elevation_deg: float) -> Any:
    """Return swept building-shadow geometries in the projected CRS."""
    raise NotImplementedError("Lane B implements building shadow casting")


def tree_shadows(trees: Any, azimuth_deg: float, elevation_deg: float) -> Any:
    """Return tree-canopy shadow geometries in the projected CRS."""
    raise NotImplementedError("Lane B implements tree shadow casting")
