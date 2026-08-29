# Shadeney — Devpost submission text

Paste these into the matching Devpost fields. Trim freely; they are written
long so you can cut rather than pad.

---

## Tagline (one line)

Walking directions that route you through the shade.

---

## Inspiration

Sydney is a city you walk, and for six months of the year it is a city you walk
squinting. Every map app answers one question — what is fastest — and treats a
1.1 km walk down a bare arterial as identical to the same distance under
street trees. It is not identical. It is the difference between arriving
comfortable and arriving cooked.

The theme is the blocks that make up our world. Shade is one of those blocks:
unevenly distributed, invisible in every dataset people actually use, and
quietly deciding who walks and who does not. Older people, people with young
kids, people with light-sensitive conditions, anyone in a wheelchair sitting
lower and closer to hot pavement — for them a shaded route is not a preference.

## What it does

Shadeney gives you two walking routes between any two points and lets you
choose: the fastest, or the one that keeps you out of direct sun. You pick the
hour of day, and the map redraws — because shade at 9am and shade at 4pm are
different cities.

On our demo route, Redfern Station to the University of Sydney:

- **fastest:** 1070 m, 13 min, 356 m in direct sun
- **cooler:** 1113 m, 14 min, 220 m in direct sun

**43 metres and one minute more, for 38% less direct sun.**

## How we built it

There is no dataset of where the shade is, so we computed one.

1. **Geometry.** 10,479 building footprints and 23,655 street trees, projected
   into metres (EPSG:7856).
2. **Solar position.** Real ephemeris (pvlib) for every hour from 06:00 to
   19:00 on the demo date.
3. **Shadow casting.** Each footprint and tree canopy is swept along its shadow
   vector — length is height / tan(solar elevation), direction is the bearing
   opposite the sun — and the swept regions are dissolved into one shadow
   layer per hour.
4. **Exposure.** Each of 30,670 walkable footpath segments is intersected
   against that layer to get the fraction of its length in direct sun. Real
   geometric difference, not point sampling.
5. **Routing.** Dijkstra over the walk graph with edge cost blending travel
   time and sun exposure, tunable by a shade-preference slider.

The result is a table of 30,670 segments x 14 hours that the API loads once at
startup, so a route comes back in about 170 ms.

## Challenges we ran into

**The shade model is invisible when it is wrong.** A sign error in the shadow
direction produces shadows of exactly the right length pointing exactly the
wrong way, and nothing looks broken. We wrote tests that pin the direction on
both axes, and treated a symmetric exposure curve peaking at solar noon as the
signature of correct solar geometry.

**Trees are not a detail.** Adding canopy dropped mean exposure at 07:00 from
0.205 to 0.137 — a third of this city's shade is trees, not buildings. The tree
service also caps at 2000 records per request, so a naive single fetch silently
loses 70% of the canopy and still looks plausible.

**The pipeline took 19 minutes and left 15 of 16 cores idle.** The 14 hours
share no state, so we parallelised them: 1120s to 193s. We verified the output
was byte-identical to the sequential run across all 429,324 values rather than
trusting the speedup.

**A black map with an empty console.** Vite's dependency pre-bundling silently
404'd MapLibre's web worker, so no vector tile could ever be parsed. Every
network request returned 200 while nothing rendered.

## What we learned

**Shade is not the same as no UV.** About 45% of ground-level UV is diffuse
skylight, so a building's shadow blocks the beam but not the sky. When we
added a live UV feed (ARPANSA), the honest dose reduction on our route came out
at 7.7%, not 38% — partly because the shadier route is also longer, and that
extra time accrues diffuse UV. Both numbers are real, but they answer different
questions: 38% is about heat and glare, 7.7% is about skin. We kept both and
labelled them separately rather than quoting the flattering one.

**Our own data is mostly estimated, and saying so is better than hiding it.**
Only 1.4% of building heights in our area are surveyed; 43.6% come from floor
counts, 29.1% from building type, and 25.9% are a generic default. The tree
data, by contrast, is nearly complete.

## What's next

- **On-demand corridors.** Routes outside the precomputed area can be fetched
  and computed live in about 3.4 seconds of compute. We built it, and left it
  out of the demo because it depends on a free public API whose latency we
  measured at anywhere from 5 seconds to a hard timeout.
- **Directional shade.** We treat canopy as opaque; partial transmission and
  seasonal leaf cover would sharpen it.
- **Heat, not just sun.** Surface temperature and wind would turn a shade model
  into a genuine thermal comfort model.

## Built with

Python, FastAPI, GeoPandas, Shapely, osmnx, pvlib, NetworkX, React, Vite,
MapLibre GL.

## Data & attribution

- Footpaths and buildings: OpenStreetMap contributors (ODbL 1.0)
- Street trees: City of Sydney (CC BY 4.0)
- Live UV index: ARPANSA
- Basemap: CARTO
