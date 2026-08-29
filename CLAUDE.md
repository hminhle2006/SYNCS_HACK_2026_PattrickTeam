# Shadeney shared engineering contract

This file is the source of truth for all implementation lanes. If a shared contract must change, discuss it with the team and update this file and the relevant schemas in the same commit.

## Product
Shadeney compares the fastest walking route with a lower-sun-exposure route for a selected local hour. It estimates direct sun exposure. It does not guarantee safety, temperature, or continuous shade.

## Ownership
- Lane A: shared configuration, contracts, dependencies, integration, scripts, README, branding, pitch and submission.
- Lane B: `backend/data/`, `backend/geo/`, and `tests/test_shadows.py`.
- Lane C: `backend/routing/` and `backend/api/`.
- Lane D: `frontend/`.

Only Lane A changes shared files: `CLAUDE.md`, `requirements.txt`, root `package.json`, `.gitignore`, `README.md`, and `backend/config.py`.

## Branches
- Lane A works on `main` and is the only merger.
- Lane B: `lane/geo`
- Lane C: `lane/api`
- Lane D: `lane/frontend`

## Time and coordinates
- Timezone: `Australia/Sydney`.
- Demo date: `2026-08-29`.
- Supported hours: integers 6 through 19 inclusive, interpreted as local civil time at the start of the hour.
- Input points use `{ "lat": ..., "lon": ... }`.
- GeoJSON coordinates always use `[longitude, latitude]`.
- Geospatial analysis CRS: `EPSG:7856`.
- Web and GeoJSON CRS: `EPSG:4326`.
- Bounding-box order is `(west, south, east, north)`.

## API contract

### `GET /api/health`
Response 200:

```json
{"status":"ok","cache_ready":false,"version":"0.1.0"}
```

### `POST /api/route`
Request:

```json
{
  "origin": {"lat": -33.8915, "lon": 151.1987},
  "destination": {"lat": -33.8847, "lon": 151.1930},
  "hour": 14,
  "shade_preference": 0.8
}
```

Response 200 always contains two routes in this order: `fastest`, then `coolest`.

```json
{
  "routes": [
    {
      "type": "fastest",
      "geometry": {"type":"LineString","coordinates":[[151.1987,-33.8915],[151.1930,-33.8847]]},
      "distance_m": 1000.0,
      "duration_s": 740.7,
      "exposed_m": 700.0,
      "exposed_frac": 0.7
    },
    {
      "type": "coolest",
      "geometry": {"type":"LineString","coordinates":[[151.1987,-33.8915],[151.1930,-33.8847]]},
      "distance_m": 1150.0,
      "duration_s": 851.9,
      "exposed_m": 460.0,
      "exposed_frac": 0.4
    }
  ],
  "comparison": {
    "extra_distance_m": 150.0,
    "extra_duration_s": 111.2,
    "exposure_reduction_m": 240.0,
    "exposure_reduction_pct": 34.3
  },
  "meta": {"hour":14,"shade_preference":0.8,"timezone":"Australia/Sydney"}
}
```

Validation:
- Latitude: `[-90, 90]`; longitude: `[-180, 180]`.
- `hour`: `[6, 19]`.
- `shade_preference`: `[0, 1]`.
- Non-finite numeric values are invalid.
- Same snapped graph node, no path, and points outside the demo area return HTTP 422.

Error response:

```json
{"detail":{"code":"NO_PATH","message":"No walking route was found between the selected locations."}}
```

Stable error codes: `INVALID_COORDINATES`, `INVALID_HOUR`, `SAME_GRAPH_NODE`, `OUTSIDE_DEMO_AREA`, `NO_PATH`, `CACHE_NOT_READY`, `INTERNAL_ROUTING_ERROR`.

### `GET /api/shadows?hour=14`
Returns the cached `FeatureCollection` from `backend/cache/shadows_14.geojson`. Invalid hours return 422. Missing cache returns 503 with `CACHE_NOT_READY`.

## Segment cache contract
`backend/cache/segments.parquet` must preserve one row per directed OSM walking edge. Required columns:
- `u`: integer-like OSM source node identifier
- `v`: integer-like OSM destination node identifier
- `key`: integer edge key
- `geometry`: LineString
- `length_m`: positive float
- `exposed_frac_06` through `exposed_frac_19`: float in `[0, 1]`

The edge identity is `(u, v, key)`. Never identify an edge by geometry alone. The file CRS is `EPSG:7856`. Lane C must transform route geometry to `EPSG:4326` before producing GeoJSON.

Generated cache files are intentionally excluded from Git. Lane B hands them off directly or through a release artifact. `scripts/run_pipeline.py` verifies their schema before integration.

## Runtime and quality gates
- Python 3.11.
- Backend API: FastAPI.
- Frontend dev origin: `http://localhost:5173`.
- Walking speed: 1.35 m/s.
- Graph and shadow caches load once at app startup, not per request.
- Target route response: under 400 ms after startup.
- Expected coolest-route demo trade-off: roughly 10 to 30 percent extra distance with a visible exposure reduction.
- Never expose a Python stack trace through an API response.

## Attribution
Maintain the credits section in `README.md` as data, libraries, tiles, fonts, and assets are introduced. OpenStreetMap attribution is mandatory.
