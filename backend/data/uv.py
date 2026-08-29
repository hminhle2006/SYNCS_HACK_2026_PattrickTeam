"""Live UV index from ARPANSA, with a clear-sky fallback.

ARPANSA is the Australian Radiation Protection and Nuclear Safety Agency --
the authoritative source for UV in Australia. Free, no API key, updated every
minute.

Unlike the OSM fetch, this is safe to call at request time: it is one small
document, it is cached, and above all it DEGRADES. If ARPANSA is unreachable we
fall back to a clear-sky estimate computed from solar elevation, which we
already calculate for the shadow model. The feature never breaks; it only loses
the cloud correction.
"""

from __future__ import annotations

import logging
import math
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime

import requests

log = logging.getLogger(__name__)

ARPANSA_URL = "https://uvdata.arpansa.gov.au/xml/uvvalues.xml"
ARPANSA_LOCATION = "syd"
CACHE_TTL_S = 60.0
REQUEST_TIMEOUT_S = 8.0

# Peak clear-sky UV index at Sydney's latitude and typical ozone. The exponent
# is the standard empirical fit of UVI against solar elevation. Sanity check:
# this gives 5.8 at Sydney solar noon on 29 Aug, and late-August Sydney runs
# 5-6 ("moderate"), so the curve lands where it should.
CLEAR_SKY_PEAK = 12.5
CLEAR_SKY_EXPONENT = 2.42

_cache: tuple[float, "UVReading"] | None = None


@dataclass(frozen=True)
class UVReading:
    index: float
    source: str          # "arpansa" or "clear-sky model"
    observed_at: str | None = None

    @property
    def is_live(self) -> bool:
        return self.source == "arpansa"


def clear_sky_uv_index(solar_elevation_deg: float) -> float:
    """Clear-sky UV index for a given solar elevation.

    Returns 0 below the horizon. This is the fallback, and also what we compare
    a live reading against to infer how much cloud is about.
    """
    if solar_elevation_deg <= 0:
        return 0.0
    return CLEAR_SKY_PEAK * (math.sin(math.radians(solar_elevation_deg)) ** CLEAR_SKY_EXPONENT)


def _fetch_arpansa() -> UVReading | None:
    resp = requests.get(ARPANSA_URL, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)

    for location in root.findall(".//location"):
        if (location.findtext("name") or "").strip().lower() != ARPANSA_LOCATION:
            continue
        if (location.findtext("status") or "").strip().lower() != "ok":
            log.warning("ARPANSA reports a non-ok status for %s", ARPANSA_LOCATION)
            return None
        raw = location.findtext("index")
        if raw is None:
            return None
        return UVReading(
            index=float(raw),
            source="arpansa",
            observed_at=(location.findtext("utcdatetime") or "").strip() or None,
        )
    return None


def current_uv_index(solar_elevation_deg: float | None = None) -> UVReading:
    """Live UV index for Sydney, falling back to the clear-sky model.

    Pass the solar elevation for the hour being displayed so the fallback is
    meaningful. Cached for CACHE_TTL_S, because ARPANSA updates once a minute
    and a route request should never wait on a network call it does not need.
    """
    global _cache

    if _cache is not None and (time.monotonic() - _cache[0]) < CACHE_TTL_S:
        return _cache[1]

    try:
        reading = _fetch_arpansa()
        if reading is not None:
            _cache = (time.monotonic(), reading)
            return reading
        log.warning("ARPANSA returned no usable reading -- using clear-sky model")
    except (requests.RequestException, ET.ParseError, ValueError) as exc:
        log.warning("ARPANSA unreachable (%s) -- using clear-sky model", exc)

    fallback = UVReading(
        index=clear_sky_uv_index(solar_elevation_deg or 0.0),
        source="clear-sky model",
    )
    _cache = (time.monotonic(), fallback)
    return fallback


def uv_index_for_hour(hour: int, when: datetime | None = None) -> UVReading:
    """UV index for a displayed hour.

    A live ARPANSA reading describes *now*. When the user is looking at some
    other hour, "now" is the wrong number -- so we only use the live value when
    the displayed hour is the current one, and otherwise model the hour being
    shown. Mixing a live reading with a different hour's shadows is the easiest
    way to put an incoherent number on screen.
    """
    from backend.config import BBOX

    # Lane A's config has no centroid, and config.py is theirs, so derive it.
    lon = (BBOX[0] + BBOX[2]) / 2.0
    lat = (BBOX[1] + BBOX[3]) / 2.0
    when = when or datetime.now()
    from backend.geo.solar import solar_position

    stamp = when.replace(hour=hour, minute=0, second=0, microsecond=0)
    _, elevation = solar_position(lat, lon, stamp)

    if hour == datetime.now().hour:
        return current_uv_index(elevation)
    return UVReading(index=clear_sky_uv_index(elevation), source="clear-sky model")
