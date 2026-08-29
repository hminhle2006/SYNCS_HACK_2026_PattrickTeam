"""ALPHA tuning sweep for the shade penalty. Run:

    python -m backend.routing.alpha_sweep

Prints, for each candidate ALPHA, how much longer and how much less
exposed the coolest route is versus the fastest on the demo pair.
Target: 10-30 percent extra distance with a visible exposure reduction.
Re-run this on real data once Lane B delivers segments.parquet; the
winning value goes to Lane A for backend/config.py.
"""
import logging

from backend.config import ALPHA, DEMO_DESTINATION, DEMO_ORIGIN, DEMO_TIME
from backend.routing.graph import load_graph
from backend.routing.route import route


def sweep(shade_preference: float = 0.8) -> None:
    graph = load_graph()
    origin = (DEMO_ORIGIN["lat"], DEMO_ORIGIN["lon"])
    destination = (DEMO_DESTINATION["lat"], DEMO_DESTINATION["lon"])

    print(
        f"graph source: {graph.graph.get('source')} | demo pair at hour "
        f"{DEMO_TIME}, shade_preference {shade_preference} | current ALPHA {ALPHA}"
    )
    print(f"{'alpha':>5} | {'extra dist':>10} | {'extra time':>10} | {'exposure cut':>12}")
    for alpha in range(1, 9):
        fastest, coolest = route(
            graph, origin, destination, DEMO_TIME, shade_preference, alpha=alpha
        )
        extra_pct = (coolest.distance_m / fastest.distance_m - 1) * 100
        extra_s = coolest.duration_s - fastest.duration_s
        cut_pct = (
            (1 - coolest.exposed_m / fastest.exposed_m) * 100
            if fastest.exposed_m
            else 0.0
        )
        marker = " *" if alpha == ALPHA else ""
        print(
            f"{alpha:>5} | {extra_pct:>9.1f}% | {extra_s:>9.0f}s | {cut_pct:>11.1f}%{marker}"
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sweep()
