"""Solar-position interface owned by Lane B."""
from datetime import datetime


def solar_position(lat: float, lon: float, when: datetime) -> tuple[float, float]:
    """Return solar azimuth and elevation in degrees."""
    raise NotImplementedError("Lane B implements solar geometry with pvlib")
