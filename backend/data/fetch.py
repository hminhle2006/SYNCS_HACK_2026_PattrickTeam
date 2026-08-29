"""Data-acquisition interfaces owned by Lane B."""
from typing import Any


def fetch_footpaths(bbox: tuple[float, float, float, float]) -> Any:
    """Fetch or load a cached OSM walking graph for west/south/east/north bbox."""
    raise NotImplementedError("Lane B implements footpath acquisition and caching")


def fetch_buildings(bbox: tuple[float, float, float, float]) -> Any:
    """Fetch or load cached OSM building footprints."""
    raise NotImplementedError("Lane B implements building acquisition and caching")


def fetch_trees(bbox: tuple[float, float, float, float]) -> Any:
    """Fetch or load cached City of Sydney tree data."""
    raise NotImplementedError("Lane B implements tree acquisition and caching")
