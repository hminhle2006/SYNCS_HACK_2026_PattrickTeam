"""Stage 5: the validation figure.

Renders computed shadows over a satellite basemap so a human can look at it
and say yes, that is where the shade is. This is the slide that convinces a
judge the numbers are real rather than plausible-looking.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd

CACHE_DIR = Path(__file__).resolve().parents[1] / "cache"
CRS_WEB = "EPSG:3857"


def validation_figure(
    hour: str = "14",
    centre: tuple[float, float] = (151.2093, -33.8688),
    span_m: float = 400.0,
    out: Path | None = None,
) -> Path:
    """Shadows at `hour` over satellite imagery, cropped to a recognisable block.

    Default centre is Martin Place / Pitt St -- dense towers, long shadows,
    and somewhere anyone in the room can identify from the aerial alone.
    """
    # matplotlib and contextily are imported here rather than at module level:
    # this file only builds the validation figure for the slide deck, and
    # neither package is needed to run the app. Keeping them lazy means a
    # fresh `pip install -r requirements.txt` does not have to carry them.
    import contextily as cx
    import matplotlib.pyplot as plt

    shadows = gpd.read_file(CACHE_DIR / f"shadows_{hour}.geojson").to_crs(CRS_WEB)
    focus = (
        gpd.GeoDataFrame({"geometry": [gpd.points_from_xy([centre[0]], [centre[1]])[0]]},
                         crs="EPSG:4326")
        .to_crs(CRS_WEB)
    )
    cx_, cy_ = focus.geometry.iloc[0].x, focus.geometry.iloc[0].y

    fig, axes = plt.subplots(1, 2, figsize=(15, 7.5))
    for ax, overlay in zip(axes, (False, True)):
        ax.set_xlim(cx_ - span_m, cx_ + span_m)
        ax.set_ylim(cy_ - span_m, cy_ + span_m)
        if overlay:
            shadows.plot(ax=ax, color="#1a1a2e", alpha=0.55, edgecolor="none", zorder=2)
        cx.add_basemap(ax, source=cx.providers.Esri.WorldImagery, zorder=1, attribution_size=6)
        ax.set_title("Satellite" if not overlay else f"Computed shadows, {hour}:00 AEST",
                     fontsize=13)
        ax.set_xticks([]); ax.set_yticks([])

    fig.suptitle("Shadeney - shadow model vs. reality", fontsize=15, y=0.97)
    fig.tight_layout()
    out = out or CACHE_DIR / f"validation_{hour}.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return out
