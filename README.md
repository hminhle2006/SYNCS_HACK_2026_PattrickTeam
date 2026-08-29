# Shadeney

**SYNCS HACK 2026: Blocks That Make Up the World**

Shadeney is a time-aware pedestrian routing app that helps people compare the fastest walking route with an alternative estimated to have less direct sun exposure. It combines walking paths, buildings, trees and solar geometry to make existing urban shade easier to use.

> Status: hackathon build in progress. Shadeney estimates direct sun exposure and does not guarantee safety, temperature, or continuous shade.

## The problem

A walking route is usually optimised only for distance or duration. In exposed parts of Sydney, two routes of similar length can provide very different experiences at the same time of day. Existing buildings and trees already create shade, but ordinary routing does not treat that shade as a usable urban resource.

## What it does

- Calculates the sun position for each supported local hour.
- Casts estimated shadows from building footprints and tree canopies.
- Measures the exposed fraction of each walkable path segment.
- Compares the fastest route with a lower-exposure route.
- Lets the user control how strongly shade should influence routing.
- Explains the trade-off through distance, duration and estimated exposure.

## Architecture

```text
OpenStreetMap paths and buildings + City of Sydney tree data
                              |
                     Solar and shadow model
                              |
               Hourly path-segment exposure cache
                              |
                    Shade-aware route engine
                              |
                        FastAPI contract
                              |
                      React map interface
```

The technical core is not a chatbot or wrapper. Shadeney models shadows in a projected coordinate system, intersects those shadow polygons with walking segments, and applies the resulting exposure values to a time-dependent routing cost.

## Repository lanes

- **Lane A:** contracts, scaffold, integration, dependencies, README, pitch and submission.
- **Lane B:** data acquisition, solar geometry, shadow casting and segment exposure.
- **Lane C:** walking graph, routing cost and backend API.
- **Lane D:** frontend map and user interaction.

Shared interfaces and file schemas are defined in [`CLAUDE.md`](CLAUDE.md). Despite the filename, it is the engineering contract for every contributor and does not require a particular AI tool.

## Running locally

### Backend

Python 3.11 is expected.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.api.main:app --reload
```

The health endpoint is available at:

```text
http://localhost:8000/api/health
```

### Generated data cache (required)

The shadow and exposure data is generated, not committed, so a fresh clone gives
you the full source and a non-functional app. Unzip `shadeney-cache.zip` into
`backend/cache/` before starting the backend:

```text
backend/cache/segments.parquet                        2.4 MB
backend/cache/shadows_06.geojson … shadows_19.geojson  14 files
backend/cache/validation_09.png, _14.png, _17.png      slide material
```

Without it, `/api/route` falls back to a synthetic stand-in graph and
`/api/shadows` returns `CACHE_NOT_READY`. To regenerate from source instead, run
`python -m backend.geo.pipeline` — this goes through the Overpass API and takes
several minutes, so prefer the zip near a deadline.

### Frontend

```bash
npm install --prefix frontend
npm run dev
```

The Vite development server runs at:

```text
http://localhost:5173
```

### Integration check

```bash
python scripts/run_pipeline.py
```

Before Lane B provides `backend/cache/segments.parquet`, the integration check validates the scaffold and reports that the cache-dependent checks are deferred. After handoff, it validates edge identity, CRS, lengths and all hourly exposure values.

## API summary

- `GET /api/health`
- `POST /api/route`
- `GET /api/shadows?hour=14`
- `GET /api/uv?hour=14` — UV index for the hour, live from ARPANSA when that hour
  is the current one, otherwise a clear-sky model estimate
- `POST /api/uv-dose` — same request body as `/api/route`; returns the UV dose in
  SED and minutes-to-burn for both routes

The stable request and response schemas are documented in [`CLAUDE.md`](CLAUDE.md) and implemented in `backend/api/schemas.py`.

## Demo

- **Video, maximum 3 minutes:** TODO
- **Live demo:** TODO

## Validation and limitations

The shadow model is tested and visually validated, not asserted:

- **Shadow direction and length.** Synthetic cases pin that a due-north sun casts
  its shadow due south, a due-east sun casts west, a lower sun casts a longer
  shadow, and a sun below the horizon shades everything.
- **Exact segment exposure.** Fully shaded, fully exposed and half-shaded
  segments are checked against exact expected values, using a real geometric
  difference rather than point sampling.
- **Solar position.** Sydney afternoon sun is confirmed to be north-west and high.
- **Visual comparison.** `backend/cache/validation_{09,14,17}.png` overlay the
  computed shadows on Esri satellite imagery of Martin Place, so the model can be
  checked against a place anyone in the room recognises.
- **Honest UV.** A test pins that full shade still delivers the diffuse
  component, so the claim "N% shaded means N% less UV" cannot be expressed.

Run the suite with `python -m pytest` (22 tests).

Measured limitations, from the data-quality tally the pipeline records:

- **Building heights are mostly inferred.** Only 1.4% are surveyed values; 43.6%
  are derived from floor count, 29.1% estimated from building type, and 25.9%
  fall back to a generic 10 m. Tree data is near-complete by comparison: 5
  fallbacks across 23,655 trees.
- **Shade is not the absence of UV.** Roughly 40–50% of ground-level UV is
  diffuse skylight, so a fully shaded route still delivers about half the UV of
  open sun. The app reports "less direct sun", and the UV dose endpoint models
  the diffuse term explicitly.
- **Tree canopy is treated as opaque**, which overstates the shade under sparse
  or deciduous crowns.
- **Hours 06:00, 18:00 and 19:00 sit below the horizon**, so every segment scores
  as fully shaded. The interface limits shade routing to 07:00–17:00.
- Weather, construction, traffic crossings, air quality and personal heat risk
  are outside the routing model.
- Results are estimates and should be described as lower exposure, not
  guaranteed safety.

## Team and contributions

| Member | Role and contribution |
|---|---|
| Duc Anh Luong | **Lane A — architecture and integration.** Shared API contract, cache format and file-ownership boundaries that let four branches merge with almost no conflict. Study area and demo journey, pinned dependencies, and `scripts/run_pipeline.py`, the integration check that gates each lane's handoff. |
| Hieu Minh Le | **Lane B — data and shadow geometry.** Source acquisition (10,479 building footprints, 23,655 street trees, the walk network), typology-informed height estimation, solar position, shadow casting and per-segment exposure. Produced the 30,670-segment hourly exposure table the product runs on, parallelised the pipeline from 19 minutes to 3, and added the live UV index and erythemal dose model. |
| Tuan Minh Nguyen | **Lane C — routing and API.** Walk-graph builder, the shade-weighted cost function blending travel time against sun exposure, the Dijkstra search producing the fastest/coolest pair, and the FastAPI surface with its stable error contract and UV endpoints. Routes return in ~170 ms over the full graph. |
| Quang Minh Nguyen | **Lane D — frontend and interface design.** The entire UI: MapLibre map with both route overlays and live tree canopy, route comparison cards, UV dose panel, time-of-day controls, destination search, and the visual design language. |

The demo video, pitch and project narrative were made collaboratively by all four members.

We used AI coding assistance (Claude) throughout, most heavily in Lane B's geometry pipeline and Lane C's routing. Architecture, problem framing and final code were owned and reviewed by the members above. Some Lane C commits carry the author name "Claude" because of a misconfigured Git identity; Tuan Minh Nguyen is the author of that work.

## Credits and third-party material

Record every dependency, dataset, tile provider, icon, font and asset as it is introduced.

| What | Source | Licence | Use |
|---|---|---|---|
| OpenStreetMap data | OpenStreetMap contributors | ODbL | Walking network and building footprints |
| City of Sydney Trees | City of Sydney | **CC BY 4.0 — attribution required in-app** | 23,655 tree locations, height and canopy spread |
| OSMnx | Open source project | MIT | OpenStreetMap download and graph utilities |
| GeoPandas | Open source project | BSD-3-Clause | Geospatial tables and operations |
| Shapely | Open source project | BSD-3-Clause | Geometry and shadow intersections |
| NetworkX | Open source project | BSD-3-Clause | Walking graph and routing |
| pvlib-python | Open source project | BSD-3-Clause | Solar-position calculations |
| FastAPI | Open source project | MIT | Backend API |
| React | Meta and contributors | MIT | Frontend user interface |
| Vite | Open source project | MIT | Frontend development and build |
| MapLibre GL JS | MapLibre contributors | BSD-3-Clause | Interactive map rendering |
| CARTO basemap tiles | CARTO | Free tier, attribution required | Dark basemap under the route overlay |
| ARPANSA UV index | Australian Radiation Protection and Nuclear Safety Agency | Public data | Live UV index for Sydney |
| Esri World Imagery | Esri, via `contextily` | Esri terms — attribution required | Satellite basemap in the shadow validation figures |
| Claude Code | Anthropic | Commercial tool | AI pair programming; assisted commits carry a co-author trailer and are visible in the Git history |

**In-app attribution.** ODbL and CC BY both require credit where the data is
shown, not only here. The map footer must carry:

> Map data © OpenStreetMap contributors · Tree data © City of Sydney (CC BY 4.0)

## Submission checklist

- [x] Public Git repository
- [x] Maintained multi-contributor commit history
- [x] Succinct project description and features
- [ ] Demo video, no longer than 3 minutes, with public viewing permission
- [ ] Live demo URL, if deployed
- [x] Open-source and third-party credits
- [ ] Final per-member contribution summary — three rows evidenced from Git history; the fourth needs a name or removal
- [x] Validation image and honest limitations
- [ ] Devpost submission before 12:00 pm AEST on Sunday, 30 August 2026
