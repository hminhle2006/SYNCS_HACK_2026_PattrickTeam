"""Routing graph interface owned by Lane C."""
from typing import Any


def build_graph(segments: Any) -> Any:
    """Build a directed walking graph from the segment cache."""
    raise NotImplementedError("Lane C implements graph construction")
