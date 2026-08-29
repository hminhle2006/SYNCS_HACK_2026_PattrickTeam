"""UV dose tests.

The one that matters is test_shade_does_not_eliminate_uv: it pins the claim we
are allowed to make in the pitch.
"""

import pytest

from backend.data.uv import clear_sky_uv_index
from backend.geo.dose import DIFFUSE_FRACTION_OPEN, compare_doses, route_uv_dose


class TestClearSkyModel:
    def test_below_horizon_is_zero(self):
        assert clear_sky_uv_index(-5.0) == 0.0
        assert clear_sky_uv_index(0.0) == 0.0

    def test_sydney_late_august_noon_is_moderate(self):
        # Solar elevation 46.7 deg -- our computed value for 29 Aug solar noon.
        # Late-August Sydney sits in the "moderate" band, 5-6.
        assert clear_sky_uv_index(46.7) == pytest.approx(5.8, abs=0.4)

    def test_rises_with_elevation(self):
        assert clear_sky_uv_index(20) < clear_sky_uv_index(40) < clear_sky_uv_index(60)


class TestDose:
    def test_hour_at_uvi_6_is_about_three_burn_doses(self):
        # Fully exposed: UVI 6 for one hour = 6 * 3600 / 2500 = 8.64 SED,
        # against a ~2.5 SED burn threshold.
        d = route_uv_dose(uv_index=6.0, duration_s=3600, exposed_frac=1.0)
        assert d.sed == pytest.approx(8.64, abs=0.01)
        assert d.minutes_to_burn == pytest.approx(17.4, abs=0.5)

    def test_shade_does_not_eliminate_uv(self):
        """Fully shaded still delivers the diffuse component.

        This is the guard on the pitch. If someone "optimises" the diffuse term
        away, this fails and the claim "N% shaded means N% less UV" -- which is
        wrong -- stops being expressible.
        """
        shaded = route_uv_dose(uv_index=6.0, duration_s=3600, exposed_frac=0.0)
        exposed = route_uv_dose(uv_index=6.0, duration_s=3600, exposed_frac=1.0)

        assert shaded.sed > 0, "full shade must still deliver diffuse UV"
        assert shaded.sed == pytest.approx(exposed.sed * DIFFUSE_FRACTION_OPEN, rel=1e-6)
        # Total shade cuts UV by ~55%, nowhere near 100%.
        assert 0.5 < (1 - shaded.sed / exposed.sed) < 0.6

    def test_zero_uv_gives_zero_dose_and_no_burn(self):
        d = route_uv_dose(uv_index=0.0, duration_s=3600, exposed_frac=1.0)
        assert d.sed == 0.0
        assert d.minutes_to_burn is None

    def test_exposure_is_clamped(self):
        assert route_uv_dose(6.0, 600, 1.7).exposed_frac == 1.0
        assert route_uv_dose(6.0, 600, -0.3).exposed_frac == 0.0


class TestComparison:
    def test_uv_reduction_is_smaller_than_sun_reduction(self):
        """The headline honesty check.

        Our demo route cuts direct sun 33% -> 20%, a 38% relative reduction.
        The UV reduction must come out visibly smaller because of the diffuse
        floor -- if it ever matches, the diffuse term has been lost.
        """
        fastest = route_uv_dose(5.8, 792, 0.33)
        coolest = route_uv_dose(5.8, 824, 0.20)
        result = compare_doses(fastest, coolest)

        sun_reduction_pct = 100 * (0.33 - 0.20) / 0.33   # ~39%
        assert 0 < result["uv_reduction_pct"] < sun_reduction_pct
        assert result["uv_reduction_pct"] < 15.0
