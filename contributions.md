# Team contributions — Pattrick Team

Four members, working in parallel lanes against a shared API contract.

---

## Hieu Minh Le — Lane B, data & shadow geometry

Built the shade model the whole product rests on. Acquired and cached the
source data (10,479 OpenStreetMap building footprints, 23,655 City of Sydney
street trees, the walkable footpath network), resolved missing building heights
through a typology-informed estimator, and implemented the solar geometry:
shadow casting from real ephemeris, dissolved hourly shadow layers, and
per-segment sun exposure by geometric difference.

Produced the project's core dataset — 30,670 footpath segments with a sun
exposure fraction for every hour from 06:00 to 19:00 — and parallelised the
pipeline from 19 minutes to 3, verifying the parallel output was identical to
the sequential run across all 429,324 values. Also added the live UV index
integration and the erythemal dose model, and wrote the project's test suite.

*Files: `backend/geo/`, `backend/data/`, `tests/`*

## Tuan Minh Nguyen — Lane C, routing & API

Built the routing engine and the HTTP surface. Implemented the walk-graph
builder, the shade-weighted cost function that blends travel time against sun
exposure, and the Dijkstra search that produces the fastest and coolest route
pair. Wired up the FastAPI endpoints, the stable error-code contract for
invalid requests and unroutable journeys, and the shadow overlay endpoint.
Also ran a tuning sweep to calibrate the shade penalty.

Routes return in roughly 170 ms against the full 30,670-segment graph.

*Files: `backend/api/`, `backend/routing/`*

> **Note on git attribution:** these seven commits are recorded under the author
> name "Claude" because of a misconfigured git identity in the development
> environment, not because the work is unattributed. Tuan Minh Nguyen is the
> author of Lane C. See the AI assistance note below.

## Duc Anh Luong — Lane A, architecture & integration

Set up the project architecture and kept four parallel lanes from colliding.
Authored the shared contract that defined the API schema, the cache format, the
edge-identity convention and the file-ownership boundaries every other lane
built against — which is why three independent branches merged with zero
conflicts. Defined the study area and demo journey, pinned the dependency set,
and wrote the integration harness that validates the generated cache against
the contract and gates each lane's handoff.

*Files: `backend/config.py`, `backend/api/schemas.py`, `scripts/`, project
scaffold*

> Committed under two git identities (`AnhLuongDuc` and `Duc Anh Luong`); both
> are the same person.

## Quang Minh Nguyen — Lane D, frontend & interface design

Designed and built the entire user interface: the MapLibre map with both route
overlays, the route comparison cards, the sun-position slider that redraws the
city for any hour of the day, and the visual design language. Responsible for
the product's look and for making an abstract exposure fraction legible as a
choice a person can actually make.

*Files: `frontend/`*

---

## Shared

The demo video, the pitch, and the project narrative were made collaboratively
by all four members.

## AI assistance

We used AI coding assistance (Claude) across the project, most heavily in
Lane B's geometry pipeline and Lane C's routing. All architectural decisions,
the problem framing, and the final code were owned and reviewed by the team
members named above. The "Claude" author name on Lane C's commits is a git
configuration artifact rather than a statement of authorship.
