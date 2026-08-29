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

### Frontend

```bash
npm install
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

The stable request and response schemas are documented in [`CLAUDE.md`](CLAUDE.md) and implemented in `backend/api/schemas.py`.

## Demo

- **Video, maximum 3 minutes:** TODO
- **Live demo:** TODO

## Validation and limitations

Planned validation includes a synthetic shadow-direction test, exact segment-exposure cases, solar-position sanity checks and a visual comparison of computed shadows with a known place and timestamp.

Known limitations for the first prototype:

- Building and tree heights may require documented fallback estimates.
- Tree canopy is initially treated as opaque.
- Weather, construction, traffic crossings, air quality and personal heat risk are outside the routing model.
- Results are estimates and should be described as lower exposure, not guaranteed safety.

## Team and contributions

This table must be updated continuously and checked against Git history before submission.

| Member | Role and contribution |
|---|---|
| Duc Anh Luong | Lane A: shared contracts, scaffold, integration pipeline, release coordination, README and pitch support |
| Hieu Minh Le | TODO |
| Team member 3 | TODO |
| Team member 4 | TODO |

## Credits and third-party material

Record every dependency, dataset, tile provider, icon, font and asset as it is introduced.

| What | Source | Licence | Use |
|---|---|---|---|
| OpenStreetMap data | OpenStreetMap contributors | ODbL | Walking network and building footprints |
| City of Sydney open data | City of Sydney | Confirm dataset-specific terms | Tree locations and attributes |
| OSMnx | Open source project | MIT | OpenStreetMap download and graph utilities |
| GeoPandas | Open source project | BSD-3-Clause | Geospatial tables and operations |
| Shapely | Open source project | BSD-3-Clause | Geometry and shadow intersections |
| NetworkX | Open source project | BSD-3-Clause | Walking graph and routing |
| pvlib-python | Open source project | BSD-3-Clause | Solar-position calculations |
| FastAPI | Open source project | MIT | Backend API |
| React | Meta and contributors | MIT | Frontend user interface |
| Vite | Open source project | MIT | Frontend development and build |
| MapLibre GL JS | MapLibre contributors | BSD-3-Clause | Planned interactive map rendering |
| Tailwind CSS | Tailwind Labs | MIT | Planned interface styling |

Map tiles, icons and fonts must be added here with their exact provider and licence before use.

## Submission checklist

- [x] Public Git repository
- [ ] Maintained multi-contributor commit history
- [x] Succinct project description and features
- [ ] Demo video, no longer than 3 minutes, with public viewing permission
- [ ] Live demo URL, if deployed
- [x] Open-source and third-party credits started
- [ ] Final per-member contribution summary
- [ ] Validation image and honest limitations
- [ ] Devpost submission before 12:00 pm AEST on Sunday, 30 August 2026
