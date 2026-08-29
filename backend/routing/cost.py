"""Shared routing cost function stub owned by Lane C."""
from backend.config import ALPHA


def edge_cost(
    length_m: float,
    exposed_frac: float,
    shade_preference: float,
    alpha: float | None = None,
) -> float:
    """Return shade-aware weighted edge cost.

    alpha overrides the shared ALPHA only for tuning sweeps; production
    callers leave it unset.
    """
    if alpha is None:
        alpha = ALPHA
    return length_m * (1 + alpha * shade_preference * exposed_frac)
