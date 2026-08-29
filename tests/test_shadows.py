"""The only tests worth writing tonight.

A sign or convention error in the shadow geometry is invisible to the eye and
silently ruins every number downstream. These pin it down.
"""

from datetime import datetime

import geopandas as gpd
import pytest
from shapely.geometry import LineString, box

from backend.geo.exposure import segment_exposure
from backend.geo.shadows import CRS_METRES, cast_shadows

# Somewhere real in MGA zone 56, so the numbers look like Sydney.
E0, N0 = 334_000.0, 6_250_000.0


def _building(height_m: float = 10.0) -> gpd.GeoDataFrame:
    """A 10 m square footprint."""
    return gpd.GeoDataFrame(
        {"height_m": [height_m], "geometry": [box(E0, N0, E0 + 10, N0 + 10)]},
        crs=CRS_METRES,
    )


class TestShadowDirection:
    """Azimuth is clockwise from north: sin drives easting, cos drives northing.

    Swapping them still produces plausible-looking shadows of the right length
    pointing the wrong way, which is exactly why these assertions exist.
    """

    def test_sun_due_north_casts_shadow_due_south(self):
        # 10 m tall, sun at 45 deg elevation => shadow exactly 10 m long.
        shadows = cast_shadows(_building(10.0), azimuth_deg=0.0, elevation_deg=45.0)
        minx, miny, maxx, maxy = shadows.total_bounds

        assert miny == pytest.approx(N0 - 10.0, abs=1e-6), "shadow should reach 10 m south"
        assert maxy == pytest.approx(N0 + 10.0, abs=1e-6), "north edge unmoved"
        # No east-west drift: a sin/cos swap would show up here.
        assert minx == pytest.approx(E0, abs=1e-6)
        assert maxx == pytest.approx(E0 + 10.0, abs=1e-6)

    def test_sun_due_east_casts_shadow_due_west(self):
        shadows = cast_shadows(_building(10.0), azimuth_deg=90.0, elevation_deg=45.0)
        minx, miny, maxx, maxy = shadows.total_bounds

        assert minx == pytest.approx(E0 - 10.0, abs=1e-6), "shadow should reach 10 m west"
        assert maxx == pytest.approx(E0 + 10.0, abs=1e-6), "east edge unmoved"
        assert miny == pytest.approx(N0, abs=1e-6)
        assert maxy == pytest.approx(N0 + 10.0, abs=1e-6)

    def test_lower_sun_casts_longer_shadow(self):
        low = cast_shadows(_building(10.0), 0.0, 20.0).total_bounds[1]
        high = cast_shadows(_building(10.0), 0.0, 60.0).total_bounds[1]
        assert low < high, "a lower sun must cast further"

    def test_sun_below_horizon_shades_everything(self):
        shadows = cast_shadows(_building(10.0), azimuth_deg=0.0, elevation_deg=1.0)
        assert len(shadows) == 1
        assert shadows.geometry.iloc[0].contains(box(E0, N0, E0 + 10, N0 + 10).centroid)

    def test_zero_height_is_skipped_not_divided_by(self):
        shadows = cast_shadows(_building(0.0), azimuth_deg=0.0, elevation_deg=45.0)
        assert shadows.empty


class TestSegmentExposure:
    """Exposure is 1 - shaded_length / total_length."""

    @staticmethod
    def _shadow():
        return gpd.GeoDataFrame({"geometry": [box(E0, N0, E0 + 100, N0 + 100)]}, crs=CRS_METRES)

    @staticmethod
    def _segments():
        return gpd.GeoDataFrame(
            {
                "geometry": [
                    LineString([(E0 + 10, N0 + 50), (E0 + 90, N0 + 50)]),   # fully inside
                    LineString([(E0 + 200, N0 + 50), (E0 + 280, N0 + 50)]), # fully outside
                    LineString([(E0 + 50, N0 + 50), (E0 + 150, N0 + 50)]),  # half in
                ]
            },
            crs=CRS_METRES,
        )

    def test_fully_shaded_segment_is_zero(self):
        result = segment_exposure(self._segments(), self._shadow())
        assert result.iloc[0] == pytest.approx(0.0, abs=1e-9)

    def test_fully_exposed_segment_is_one(self):
        result = segment_exposure(self._segments(), self._shadow())
        assert result.iloc[1] == pytest.approx(1.0, abs=1e-9)

    def test_half_shaded_segment_is_half(self):
        result = segment_exposure(self._segments(), self._shadow())
        assert result.iloc[2] == pytest.approx(0.5, abs=1e-6)

    def test_no_shadows_means_fully_exposed(self):
        empty = gpd.GeoDataFrame({"geometry": []}, crs=CRS_METRES, geometry="geometry")
        result = segment_exposure(self._segments(), empty)
        assert (result == 1.0).all()


class TestSolarSanity:
    """Sydney, 29 Aug 2026, 14:00 AEST.

    NOTE: the lane brief says elevation should land in "the twenties or low
    thirties" at this timestamp. That is wrong -- it is ~37.7 deg. Twenties is
    the 09:00 figure. Pinning the correct value here so nobody "fixes" working
    code to match a bad expectation.
    """

    def test_sydney_afternoon_sun_is_northwest_and_high(self):
        from backend.geo.solar import solar_position

        az, el = solar_position(-33.8688, 151.2093, datetime(2026, 8, 29, 14, 0))

        assert 270.0 < az < 360.0, f"afternoon sun must be north-west, got {az:.1f}"
        assert el == pytest.approx(37.7, abs=1.5), f"expected ~37.7 deg, got {el:.1f}"
