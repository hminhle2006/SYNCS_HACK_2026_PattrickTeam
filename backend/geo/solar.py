"""Solar position. Thin wrapper over pvlib -- we do not roll our own."""

from __future__ import annotations

from datetime import datetime

import pandas as pd
from pvlib import solarposition

SYDNEY_TZ = "Australia/Sydney"


def solar_position(lat: float, lon: float, when: datetime) -> tuple[float, float]:
    """Return (azimuth_deg, elevation_deg) for a single instant.

    Azimuth is degrees clockwise from north (pvlib's convention already).
    Elevation is degrees above the horizon; negative means below.
    """
    az, el = solar_position_series(lat, lon, [when])
    return float(az[0]), float(el[0])


def solar_position_series(lat: float, lon: float, whens) -> tuple[pd.Series, pd.Series]:
    """Vectorised form -- one pvlib call for many timestamps.

    Prefer this when building the hourly table; calling solar_position in a
    loop over 14 hours re-does the ephemeris work every time.
    """
    idx = pd.DatetimeIndex(pd.to_datetime(list(whens)))
    if idx.tz is None:
        idx = idx.tz_localize(SYDNEY_TZ)
    frame = solarposition.get_solarposition(idx, lat, lon)
    return frame["azimuth"].reset_index(drop=True), frame["apparent_elevation"].reset_index(drop=True)


def hours_of_day(date, tz: str = SYDNEY_TZ, start: int = 6, end: int = 19) -> list[pd.Timestamp]:
    """Local-time timestamps for each whole hour in [start, end] inclusive."""
    return [
        pd.Timestamp(year=date.year, month=date.month, day=date.day, hour=h, tz=tz)
        for h in range(start, end + 1)
    ]
