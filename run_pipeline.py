import logging, sys, warnings
warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
sys.path.insert(0, ".")
from backend.geo.pipeline import build_segments_table, handoff_readout
from backend.data import fetch

segs = build_segments_table()
print()
print(handoff_readout(segs), flush=True)
print()
print(fetch.fallback_report(), flush=True)
