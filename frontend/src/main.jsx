import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// On a phone the app is loaded from the laptop's LAN address, where "localhost"
// would mean the handset itself. Defaulting to whatever host served the page
// keeps the demo working on both without an environment variable.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

// Bounds for the tree fetch. Covers the demo corridor; the backend clips the
// cached City of Sydney extract to it.
const TREE_BOUNDS = { west: 151.186, south: -33.897, east: 151.203, north: -33.882 };
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// Landmarks inside the exposure cache's bounding box. The cache covers
// Annandale/Glebe through Newtown and Redfern to the western CBD, so anything
// outside it would come back OUTSIDE_DEMO_AREA.
const PLACES = [
  { id: "redfern", name: "Redfern Station", detail: "Lawson St, Redfern", lat: -33.8913, lon: 151.198 },
  { id: "usyd", name: "University of Sydney", detail: "Camperdown campus", lat: -33.887, lon: 151.1902 },
  { id: "victoria-park", name: "Victoria Park", detail: "Broadway, Camperdown", lat: -33.8889, lon: 151.1938 },
  { id: "broadway", name: "Broadway Shopping Centre", detail: "Bay St, Glebe", lat: -33.8836, lon: 151.1946 },
  { id: "seymour", name: "Seymour Centre", detail: "City Rd, Chippendale", lat: -33.888, lon: 151.193 },
  { id: "carriageworks", name: "Carriageworks", detail: "Wilson St, Eveleigh", lat: -33.8972, lon: 151.1856 },
  { id: "newtown", name: "Newtown Station", detail: "King St, Newtown", lat: -33.8983, lon: 151.1795 },
  { id: "camperdown-park", name: "Camperdown Memorial Rest Park", detail: "Newtown", lat: -33.8905, lon: 151.178 },
  { id: "rpa", name: "Royal Prince Alfred Hospital", detail: "Missenden Rd, Camperdown", lat: -33.8895, lon: 151.181 },
  { id: "erskineville", name: "Erskineville Station", detail: "Erskineville Rd", lat: -33.902, lon: 151.1857 },
  { id: "prince-alfred-park", name: "Prince Alfred Park", detail: "Surry Hills", lat: -33.889, lon: 151.204 },
  { id: "central", name: "Central Station", detail: "Eddy Ave, Haymarket", lat: -33.8832, lon: 151.207 },
  { id: "harold-park", name: "Harold Park / Tramsheds", detail: "Forest Lodge", lat: -33.883, lon: 151.179 },
];

const DEFAULT_ORIGIN = PLACES[0];
const DEFAULT_DESTINATION = PLACES[1];

// The shade model runs 06:00-19:00, but at 06, 18 and 19 the sun is BELOW the
// horizon in Sydney, so every segment is fully shaded and both routes score
// identically. Clamping to those hours makes the app report "100% shaded,
// 0% less sun" all night -- which reads as a product that does nothing.
// Outside daylight we preview the recommended hour instead.
const FIRST_LIT_HOUR = 7;
const LAST_LIT_HOUR = 17;
const PREVIEW_HOUR = 14;

function isDaylight(date = new Date()) {
  const h = date.getHours();
  return h >= FIRST_LIT_HOUR && h <= LAST_LIT_HOUR;
}

function serviceHour(date = new Date()) {
  return isDaylight(date) ? date.getHours() : PREVIEW_HOUR;
}

function formatHourLabel(hour) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric" }).format(d);
}

function formatClock(date) {
  return new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatMinutes(seconds) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function shadeLabel(preference) {
  if (preference <= 0.15) return "Speed first";
  if (preference <= 0.45) return "Slight preference for shade";
  if (preference <= 0.75) return "Balanced";
  if (preference < 1) return "Strong preference for shade";
  return "Shade at any cost";
}

// Offline stand-in, scaled from the measured demo journey (1070 m / 356 m in sun
// versus 1113 m / 220 m) so the fallback can never overclaim what the real
// model produces. Shown only when the API is unreachable, and labelled as such.
function demoRouteResponse(hour, shadePreference) {
  const daylightWeight = 1 - Math.min(Math.abs(hour - 14) / 8, 0.72);
  const reduction = Math.round(8 + daylightWeight * shadePreference * 33);
  const addedTime = Math.round(12 + daylightWeight * shadePreference * 50);
  const fastestExposed = 356 * (0.45 + daylightWeight * 0.55);
  return {
    routes: [
      { type: "fastest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.1962, -33.89065], [151.19415, -33.8895], [151.19215, -33.8879], [151.1902, -33.887]] }, distance_m: 1070, duration_s: 793, exposed_m: fastestExposed, exposed_frac: fastestExposed / 1070 },
      { type: "coolest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.19745, -33.8898], [151.19625, -33.88825], [151.19465, -33.88725], [151.1927, -33.88655], [151.1902, -33.887]] }, distance_m: 1113, duration_s: 793 + addedTime, exposed_m: fastestExposed * (1 - reduction / 100), exposed_frac: (fastestExposed * (1 - reduction / 100)) / 1113 },
    ],
    comparison: { extra_distance_m: 43, extra_duration_s: addedTime, exposure_reduction_m: fastestExposed * reduction / 100, exposure_reduction_pct: reduction },
    meta: { hour, shade_preference: shadePreference, timezone: "Australia/Sydney" },
  };
}

function demoShadows(hour) {
  const shift = (hour - 14) * 0.00016;
  const polygons = [
    [[151.1958, -33.8891], [151.1967, -33.88922], [151.19605 + shift, -33.88735], [151.19512 + shift, -33.88722], [151.1958, -33.8891]],
    [[151.1937, -33.88835], [151.19435, -33.88845], [151.19348 + shift, -33.88688], [151.19278 + shift, -33.88678], [151.1937, -33.88835]],
    [[151.19185, -33.88842], [151.19255, -33.8885], [151.1917 + shift, -33.88727], [151.19108 + shift, -33.88718], [151.19185, -33.88842]],
  ];
  return { type: "FeatureCollection", features: polygons.map((coordinates, index) => ({ type: "Feature", properties: { id: `shadow-${index}` }, geometry: { type: "Polygon", coordinates: [coordinates] } })) };
}

const demoCanopies = {
  type: "FeatureCollection",
  features: [[151.1971, -33.89025], [151.196, -33.8887], [151.1952, -33.88785], [151.1935, -33.88715], [151.1923, -33.8869], [151.1913, -33.88755]].map((coordinates, index) => ({ type: "Feature", properties: { id: `canopy-${index}` }, geometry: { type: "Point", coordinates } })),
};

function routeFeatures(response) {
  return { type: "FeatureCollection", features: response.routes.map((route) => ({ type: "Feature", properties: { routeType: route.type }, geometry: route.geometry })) };
}

function endpointFeatures(origin, destination) {
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } },
    { type: "Feature", properties: { kind: "destination" }, geometry: { type: "Point", coordinates: [destination.lon, destination.lat] } },
  ] };
}

function requestBody(origin, destination, hour, shadePreference) {
  return JSON.stringify({
    origin: { lat: origin.lat, lon: origin.lon },
    destination: { lat: destination.lat, lon: destination.lon },
    hour,
    shade_preference: shadePreference,
  });
}

/** Error the API itself returned, carrying its stable contract code. */
class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function postJson(path, body, signal) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!response.ok) {
    // A contract error means the service is up and rejected the request; that
    // is worth telling the user about, unlike an unreachable backend.
    const detail = await response.json().then((body) => body?.detail).catch(() => null);
    if (detail?.message) throw new ApiError(detail.code, detail.message);
    throw new Error(`${path} is unavailable.`);
  }
  return response.json();
}

async function fetchShadows(hour, signal) {
  const response = await fetch(`${API_BASE_URL}/api/shadows?hour=${hour}`, { signal });
  if (!response.ok) throw new Error("Shadow service is unavailable.");
  return response.json();
}

async function fetchTrees(signal) {
  const params = new URLSearchParams(TREE_BOUNDS);
  const response = await fetch(`${API_BASE_URL}/api/trees?${params}`, { signal });
  if (!response.ok) throw new Error("Tree service is unavailable.");
  return response.json();
}

function mapCanopySample(collection) {
  // The study-area cache can contain thousands of street trees in one view.
  // The full shade overlay remains visible; this sparse marker set keeps the
  // walking route itself easy to read.
  return {
    ...collection,
    features: collection.features.filter((_, index) => index % 3 === 0),
  };
}

function createTreeMarker() {
  // A small, hand-drawn canvas icon keeps tree locations readable against the
  // map at every zoom level without relying on an external icon licence.
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 56;
  const context = canvas.getContext("2d");
  context.scale(2, 2);
  context.lineJoin = "round";

  context.fillStyle = "rgba(28, 75, 53, 0.18)";
  context.beginPath();
  context.ellipse(12, 25.5, 8.4, 2.5, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#f2fbf4";
  context.lineWidth = 1.5;
  context.fillStyle = "#276f49";
  context.beginPath();
  context.arc(12, 8.5, 4.9, Math.PI, 0);
  context.arc(8.25, 12, 4.9, Math.PI * 0.9, Math.PI * 1.9);
  context.arc(15.75, 12, 4.9, Math.PI * 1.1, Math.PI * 0.1, true);
  context.arc(12, 15.5, 6.3, 0, Math.PI);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = "#8ecfa0";
  context.beginPath();
  context.arc(10, 9.5, 2.1, 0, Math.PI * 2);
  context.arc(14.2, 12.3, 1.8, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#715433";
  context.fillRect(10.7, 17, 2.6, 6.5);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Sun exposure across the lit day for one route, so the time dimension is
 *  visible at a glance rather than one hour at a time. One measure, one hue:
 *  pale amber for a shaded hour through deep amber for an exposed one. */
function DayProfile({ profile, hour, onPick }) {
  const best = profile.reduce((a, b) => (b.exposedFrac < a.exposedFrac ? b : a));
  const current = profile.find((entry) => entry.hour === hour);
  // Percentage of a route, so the bars run from a true zero baseline: scaling
  // to the observed range would turn a two-point spread into a dramatic one.
  const worthMoving = current && current.exposedFrac - best.exposedFrac >= 0.02;

  return (
    <div className="day-profile">
      <div className="control-head">
        <span className="profile-title" id="profile-title">Sun across the day</span>
        <span className="control-value">
          {worthMoving
            ? `Least sun at ${formatHourLabel(best.hour)} · ${Math.round(best.exposedFrac * 100)}% in sun`
            : "This is already one of the shadiest hours"}
        </span>
      </div>
      <div className="profile-bars" role="group" aria-labelledby="profile-title">
        {profile.map((entry) => {
          const percent = Math.round(entry.exposedFrac * 100);
          const isCurrent = entry.hour === hour;
          const isBest = entry.hour === best.hour;
          return (
            <button
              key={entry.hour}
              type="button"
              className={`profile-bar ${isCurrent ? "is-current" : ""} ${isBest ? "is-best" : ""}`}
              title={`${formatHourLabel(entry.hour)} — ${percent}% of the route in direct sun`}
              aria-label={`Set the time to ${formatHourLabel(entry.hour)}, ${percent} percent of the route in direct sun`}
              aria-pressed={isCurrent}
              onClick={() => onPick(entry.hour)}
            >
              <span className="profile-track">
                <span
                  className="profile-fill"
                  style={{
                    height: `${Math.max(6, entry.exposedFrac * 100)}%`,
                    // Same hue throughout; only lightness carries magnitude.
                    background: `color-mix(in oklab, #b5651f ${25 + entry.exposedFrac * 75}%, #f5dcbd)`,
                  }}
                />
              </span>
              <span className="profile-hour">{entry.hour}</span>
            </button>
          );
        })}
      </div>
      {current && (
        <p className="profile-caption">
          {Math.round(current.exposedFrac * 100)}% of the shade route is in direct sun at {formatHourLabel(hour)}
          {worthMoving && ` · leaving at ${formatHourLabel(best.hour)} would cut that to ${Math.round(best.exposedFrac * 100)}%`}
        </p>
      )}
    </div>
  );
}

/** Origin/destination field with type-ahead over the landmarks in the cache. */
function PlaceField({ id, label, value, onChange, disabled, disabledNote }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PLACES;
    return PLACES.filter((place) => `${place.name} ${place.detail}`.toLowerCase().includes(needle));
  }, [query]);

  function choose(place) {
    onChange(place);
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div className="place-field">
      <label className="place-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="place-input"
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={`${id}-options`}
        autoComplete="off"
        disabled={disabled}
        placeholder={disabled ? disabledNote : value.name}
        value={isOpen ? query : (disabled ? "" : value.name)}
        onFocus={() => { setQuery(""); setIsOpen(true); }}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 140)}
        onChange={(event) => { setQuery(event.target.value); setIsOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches.length > 0) { event.preventDefault(); choose(matches[0]); }
          if (event.key === "Escape") setIsOpen(false);
        }}
      />
      {isOpen && (
        <ul className="place-options" id={`${id}-options`} role="listbox">
          {matches.length === 0 && <li className="place-empty">No landmark in the demo area matches that.</li>}
          {matches.slice(0, 6).map((place) => (
            <li key={place.id}>
              <button type="button" role="option" aria-selected={place.id === value.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(place)}>
                <strong>{place.name}</strong><small>{place.detail}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function App() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const [originPlace, setOriginPlace] = useState(DEFAULT_ORIGIN);
  const [destinationPlace, setDestinationPlace] = useState(DEFAULT_DESTINATION);
  const [livePosition, setLivePosition] = useState(null);
  const [isTracking, setIsTracking] = useState(false);
  // The panel is tall enough to bury the map on a laptop and swallow it whole
  // on a phone. Collapsing leaves the headline and hands the map back.
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const [hourOverride, setHourOverride] = useState(null);
  const [shadePreference, setShadePreference] = useState(0.8);
  const [routeData, setRouteData] = useState(() => demoRouteResponse(serviceHour(), 0.8));
  const [shadowData, setShadowData] = useState(() => demoShadows(serviceHour()));
  // Real City of Sydney trees, fetched once. Falls back to the placeholder set
  // only if the endpoint is unreachable.
  const [canopyData, setCanopyData] = useState(demoCanopies);
  const canopyDataRef = useRef(demoCanopies);
  const [uvData, setUvData] = useState(null);
  const [dayProfile, setDayProfile] = useState(null);
  const [isSearching, setIsSearching] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUsingDemoData, setIsUsingDemoData] = useState(true);
  const [serviceMessage, setServiceMessage] = useState("Preparing the demo route.");

  const hour = hourOverride ?? serviceHour(now);
  const isFollowingClock = hourOverride === null;
  const origin = isTracking && livePosition
    ? { ...livePosition, id: "live", name: "Your live location", detail: "GPS tracking active" }
    : originPlace;

  const fastestRoute = routeData.routes.find((route) => route.type === "fastest");
  const coolestRoute = routeData.routes.find((route) => route.type === "coolest");
  const shadeCoverage = Math.round((1 - coolestRoute.exposed_frac) * 100);
  const addedMinutes = formatMinutes(routeData.comparison.extra_duration_s);
  const sunReduction = Math.round(routeData.comparison.exposure_reduction_pct);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const map = new maplibregl.Map({ container: mapContainer.current, style: MAP_STYLE, center: [151.1943, -33.8887], zoom: 15.7, pitch: 42, bearing: -18, attributionControl: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
    map.on("load", () => {
      map.addSource("shadows", { type: "geojson", data: demoShadows(serviceHour()) });
      map.addLayer({ id: "shadow-fill", type: "fill", source: "shadows", paint: { "fill-color": "#4b6870", "fill-opacity": 0.24 } });
      map.addLayer({ id: "shadow-outline", type: "line", source: "shadows", paint: { "line-color": "#7ba1a1", "line-width": 1, "line-opacity": 0.38 } });
      map.addSource("canopies", { type: "geojson", data: canopyDataRef.current });
      // Canopy pools sized by each tree's measured crown radius.
      map.addLayer({ id: "canopy-halo", type: "circle", source: "canopies", paint: { "circle-radius": ["interpolate", ["linear"], ["get", "crown_radius_m"], 2, 12, 8, 26], "circle-color": "#5da47b", "circle-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, 0.06, 16, 0.16, 17, 0.22], "circle-blur": 0.8 } });
      map.addImage("tree-marker", createTreeMarker(), { pixelRatio: 2 });
      // Markers fade out when zoomed out: 4,340 icons at overview zoom is
      // texture, not information.
      map.addLayer({ id: "tree-marker", type: "symbol", source: "canopies", layout: { "icon-image": "tree-marker", "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.2, 15.5, 0.36, 16.5, 0.55, 17, 0.62], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport" }, paint: { "icon-opacity": ["interpolate", ["linear"], ["zoom"], 14.4, 0, 15, 0.12, 15.8, 0.45, 16.5, 0.9, 17, 1] } });
      map.addSource("routes", { type: "geojson", data: routeFeatures(demoRouteResponse(serviceHour(), 0.8)) });
      map.addLayer({ id: "fastest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "fastest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d68a43", "line-width": 4, "line-opacity": 0.82 } });
      map.addLayer({ id: "coolest-route-outline", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.92 } });
      map.addLayer({ id: "coolest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#157167", "line-width": 6, "line-opacity": 1 } });
      map.addSource("endpoints", { type: "geojson", data: endpointFeatures(DEFAULT_ORIGIN, DEFAULT_DESTINATION) });
      map.addLayer({ id: "endpoint-halo", type: "circle", source: "endpoints", filter: ["==", ["get", "kind"], "origin"], paint: { "circle-radius": 14, "circle-color": "#157167", "circle-opacity": 0.15 } });
      map.addLayer({ id: "endpoints", type: "circle", source: "endpoints", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "origin"], 7, 8], "circle-color": ["case", ["==", ["get", "kind"], "origin"], "#ffffff", "#157167"], "circle-stroke-color": "#17302f", "circle-stroke-width": 2 } });
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const body = requestBody(origin, destinationPlace, hour, shadePreference);
    const debounce = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const [nextRoutes, nextShadows, nextUv] = await Promise.all([
          postJson("/api/route", body, controller.signal),
          fetchShadows(hour, controller.signal).catch(() => demoShadows(hour)),
          postJson("/api/uv-dose", body, controller.signal).catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        setRouteData(nextRoutes);
        setShadowData(nextShadows);
        setUvData(nextUv);
        setIsUsingDemoData(false);
        setServiceMessage(isTracking ? "Live location is updating your route." : "Route measured from the shade model.");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError) {
          // The service answered and refused: say why instead of quietly
          // swapping in numbers it never produced.
          setServiceMessage(error.message);
          setIsSearching(false);
          return;
        }
        setRouteData(demoRouteResponse(hour, shadePreference));
        setShadowData(demoShadows(hour));
        setUvData(null);
        setIsUsingDemoData(true);
        setServiceMessage("Backend unavailable — showing prepared sample figures, not measured results.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 320);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [origin.lat, origin.lon, destinationPlace, hour, shadePreference, isTracking]);

  // The whole-day profile depends on the endpoints and the shade preference,
  // not on the displayed hour, so it is computed once per route rather than on
  // every scrub. Debounced longer than the main fetch because it is 11 calls.
  useEffect(() => {
    const controller = new AbortController();
    const litHours = [];
    for (let h = FIRST_LIT_HOUR; h <= LAST_LIT_HOUR; h += 1) litHours.push(h);
    const debounce = window.setTimeout(async () => {
      try {
        const results = await Promise.all(litHours.map(async (h) => {
          const data = await postJson("/api/route", requestBody(origin, destinationPlace, h, shadePreference), controller.signal);
          const coolest = data.routes.find((route) => route.type === "coolest");
          return { hour: h, exposedFrac: coolest.exposed_frac, durationS: coolest.duration_s };
        }));
        if (!controller.signal.aborted) setDayProfile(results);
      } catch {
        if (!controller.signal.aborted) setDayProfile(null);
      }
    }, 700);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [origin.lat, origin.lon, destinationPlace, shadePreference]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrees(controller.signal)
      .then((trees) => { if (trees.features?.length) setCanopyData(mapCanopySample(trees)); })
      .catch((error) => { if (error.name !== "AbortError") console.warn("tree layer unavailable:", error); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Do NOT bail out while the style is still loading. This effect only
    // re-runs when its data changes, so an update that lands mid-load is
    // dropped for good and the map keeps its placeholder layer -- which is why
    // the real shadow overlay never appeared. Defer to the next idle instead.
    canopyDataRef.current = canopyData;
    const apply = () => {
      map.getSource("routes")?.setData(routeFeatures(routeData));
      map.getSource("canopies")?.setData(canopyData);
      map.getSource("shadows")?.setData(shadowData);
      map.getSource("endpoints")?.setData(endpointFeatures(origin, destinationPlace));
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("idle", apply);
    return () => map.off("idle", apply);
  }, [routeData, shadowData, canopyData, origin, destinationPlace]);

  useEffect(() => {
    if (!isTracking) return undefined;
    if (!navigator.geolocation) { setServiceMessage("This browser does not support location tracking."); setIsTracking(false); return undefined; }
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => { setLivePosition({ lat: coords.latitude, lon: coords.longitude }); },
      () => { setServiceMessage("Location permission was not granted — staying on the demo route."); setIsTracking(false); },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTracking]);

  function toggleTracking() {
    if (isTracking) { setIsTracking(false); setLivePosition(null); setServiceMessage("Live tracking paused. Back on the demo route."); return; }
    setServiceMessage("Requesting your location…");
    setIsTracking(true);
  }

  const uvBadge = uvData?.uv?.is_live ? "live" : "estimated";
  const burnMinutes = uvData?.coolest_minutes_to_burn ?? null;

  return <main className="app-shell">
    <div ref={mapContainer} className="map" aria-label="Interactive Shadeney route map" />
    <div className="map-wash" aria-hidden="true" />

    <header className="brand-panel"><div className="brand-mark" aria-hidden="true">S</div><div><p className="eyebrow">Sydney shade navigation</p><h1>Shadeney</h1></div></header>

    <section className={`search-panel ${isSearchOpen ? "is-open" : ""}`} aria-label="Plan a walk">
      <p className="journey-label">Plan a walk</p>
      {/* On a phone the two fields would eat the map, so they collapse behind a
          summary the whole route reads from. Desktop always shows them. */}
      <button className="search-summary" type="button" aria-expanded={isSearchOpen} onClick={() => setIsSearchOpen((open) => !open)}>
        <span className="search-summary-text">{origin.name} <span aria-hidden="true">→</span> {destinationPlace.name}</span>
        <span className="search-summary-action">{isSearchOpen ? "Done" : "Change"}</span>
      </button>
      <div className="search-fields">
        <PlaceField id="origin-field" label="From" value={origin} onChange={setOriginPlace} disabled={isTracking} disabledNote="Your live location" />
        <button
          className="swap-button"
          type="button"
          disabled={isTracking}
          title={isTracking ? "Pause live tracking to swap" : "Swap start and destination"}
          onClick={() => { setOriginPlace(destinationPlace); setDestinationPlace(originPlace); }}
        >
          <span aria-hidden="true">⇅</span> Swap
        </button>
        <PlaceField id="destination-field" label="To" value={destinationPlace} onChange={setDestinationPlace} />
      </div>
      <p className={`search-status ${isSearching ? "is-busy" : ""}`} role="status" aria-live="polite">
        <span className="search-spinner" aria-hidden="true" />
        {isSearching
          ? `Searching ${origin.name} → ${destinationPlace.name}…`
          : `${origin.name} → ${destinationPlace.name} · ${formatMinutes(coolestRoute.duration_s)} in shade`}
      </p>
    </section>

    <section className="route-key" aria-label="Map legend"><span><i className="route-swatch fastest" aria-hidden="true" />Fastest</span><span><i className="route-swatch coolest" aria-hidden="true" />More shade</span><span><i className="tree-swatch" aria-hidden="true" />Canopy</span></section>
    <button className={`tracking-button ${isTracking ? "is-active" : ""}`} type="button" onClick={toggleTracking}><span className="tracking-dot" aria-hidden="true" />{isTracking ? "Pause live tracking" : "Start live tracking"}</button>

    <section className={`navigation-panel ${isPanelCollapsed ? "is-collapsed" : ""}`} aria-label="Live route details">
      <button
        type="button"
        className="sheet-handle"
        onClick={() => setIsPanelCollapsed((v) => !v)}
        aria-expanded={!isPanelCollapsed}
        aria-label={isPanelCollapsed ? "Expand route details" : "Collapse route details"}
        title={isPanelCollapsed ? "Expand" : "Collapse"}
      />
      <div className="sheet-heading">
        <div>
          <p className="panel-kicker">Shade route</p>
          <h2>{shadeCoverage}% <span>shaded</span></h2>
          <p className="panel-subtitle">{isFollowingClock && isDaylight(now) ? `Sun position for ${formatClock(now)}` : `Sun position at ${formatHourLabel(hour)}`}</p>
        </div>
        <div className="route-duration"><strong>{formatMinutes(coolestRoute.duration_s)}</strong><span>{Math.round(coolestRoute.distance_m / 100) / 10} km</span></div>
      </div>

      <div className="controls">
        <div className="control">
          <div className="control-head">
            <label htmlFor="hour-slider">Time of day</label>
            <span className="control-value">{formatHourLabel(hour)}</span>
            {!isFollowingClock && <button className="control-reset" type="button" onClick={() => setHourOverride(null)}>Use now</button>}
          </div>
          <input id="hour-slider" type="range" min={FIRST_LIT_HOUR} max={LAST_LIT_HOUR} step={1} value={hour} onChange={(event) => setHourOverride(Number(event.target.value))} />
          <div className="control-scale" aria-hidden="true"><span>7 am</span><span>noon</span><span>5 pm</span></div>
        </div>
        <div className="control">
          <div className="control-head">
            <label htmlFor="shade-slider">Shade preference</label>
            <span className="control-value">{shadeLabel(shadePreference)}</span>
          </div>
          <input id="shade-slider" type="range" min={0} max={1} step={0.05} value={shadePreference} onChange={(event) => setShadePreference(Number(event.target.value))} />
          <div className="control-scale" aria-hidden="true"><span>Fastest</span><span>Shadiest</span></div>
        </div>
      </div>

      {dayProfile && <DayProfile profile={dayProfile} hour={hour} onPick={setHourOverride} />}

      <div className="route-cards" aria-label="Route comparison">
        <article className="route-card recommended">
          <div className="route-card-icon" aria-hidden="true">☂</div>
          <div className="route-card-copy">
            <p>More shade</p>
            <strong>{addedMinutes} longer · {sunReduction}% less direct sun</strong>
            <div className="exposure-meter" aria-label={`${shadeCoverage}% of the recommended route is shaded`}><span style={{ width: `${shadeCoverage}%` }} /></div>
          </div>
          <span className="recommended-tag">Best match</span>
        </article>
        <article className="route-card">
          <div className="route-card-icon warm" aria-hidden="true">☀</div>
          <div className="route-card-copy">
            <p>Fastest</p>
            <strong>{formatMinutes(fastestRoute.duration_s)} · {Math.round(fastestRoute.exposed_frac * 100)}% in sun</strong>
            <div className="exposure-meter warm-meter" aria-label="The fastest route has higher direct sun exposure"><span style={{ width: `${Math.round(fastestRoute.exposed_frac * 100)}%` }} /></div>
          </div>
        </article>
      </div>

      {uvData && (
        <div className="uv-strip">
          <div className="uv-index">
            <span className="uv-number">{uvData.uv.uv_index.toFixed(1)}</span>
            <span className="uv-caption">UV index<span className={`uv-badge ${uvBadge}`}>{uvBadge}</span></span>
          </div>
          <div className="uv-detail">
            <strong>{uvData.coolest_sed.toFixed(2)} SED on the shade route</strong>
            <span>
              {uvData.uv_reduction_pct > 0
                ? `${uvData.uv_reduction_pct.toFixed(0)}% less UV than the fastest route`
                : "No UV saving at this hour — the extra walking time offsets the shade"}
              {burnMinutes ? ` · fair skin reddens after about ${Math.round(burnMinutes)} min` : " · no burn risk at this UV level"}
            </span>
          </div>
          <p className="uv-note">Shade blocks direct sun, not the roughly 45% of UV that arrives as diffuse skylight.</p>
        </div>
      )}

      <div className="live-strip"><span className={`live-indicator ${isTracking ? "is-live" : ""}`} aria-hidden="true" /> <strong>{isTracking ? "Tracking your location" : "Demo navigation"}</strong><span>{isSearching ? "Updating…" : "Refreshes as you move"}</span></div>
      <p className={`service-note ${isUsingDemoData ? "is-demo" : ""}`} role="status">{serviceMessage}</p>
    </section>

    <p className="map-credit">Map data © OpenStreetMap contributors · Tree data © City of Sydney (CC BY 4.0)</p>
  </main>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
