"""Shared routing cost function stub owned by Lane C."""
from backend.config import ALPHA


def edge_cost(length_m: float, exposed_frac: float, shade_preference: float) -> float:
    """Return shade-aware weighted edge cost."""
    return length_m * (1 + ALPHA * shade_preference * exposed_frac)
