"""Segment-exposure interfaces owned by Lane B."""
from typing import Any


def segment_exposure(segments: Any, shadows: Any) -> Any:
    """Return exposed fraction per segment, where 0 is shaded and 1 exposed."""
    raise NotImplementedError("Lane B implements exact line/polygon exposure")


def build_segments_table() -> Any:
    """Build the hourly exposure table and write segments.parquet."""
    raise NotImplementedError("Lane B implements the cold-start geospatial pipeline")
