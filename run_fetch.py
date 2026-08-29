import logging, sys, time
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
sys.path.insert(0, ".")
from backend.config import BBOX
from backend.data import fetch

t0 = time.time()
print(f"bbox = {BBOX}", flush=True)

g = fetch.fetch_footpaths(BBOX)
print(f"[{time.time()-t0:6.1f}s] footpaths: {g.number_of_nodes()} nodes, {g.number_of_edges()} edges", flush=True)

b = fetch.fetch_buildings(BBOX)
print(f"[{time.time()-t0:6.1f}s] buildings: {len(b)} footprints", flush=True)

t = fetch.fetch_trees(BBOX)
print(f"[{time.time()-t0:6.1f}s] trees: {len(t)} points", flush=True)

print()
print(fetch.fallback_report(), flush=True)
