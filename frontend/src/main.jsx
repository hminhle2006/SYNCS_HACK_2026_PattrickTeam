import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// Derived from whatever host served the page, not hardcoded. On a laptop that
// resolves to localhost; on a phone hitting the laptop's LAN address it
// resolves to that same address. Hardcoding "localhost" breaks the phone
// silently -- there, localhost is the PHONE, so every call fails and the UI
// falls back to canned demo numbers with only a small grey warning.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  `${window.location.protocol}//${window.location.hostname}:8000`;
const DEMO_ORIGIN = { lat: -33.8913, lon: 151.198 };
const DEMO_DESTINATION = { lat: -33.887, lon: 151.1902 };
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const TREE_BOUNDS = { west: 151.186, south: -33.897, east: 151.203, north: -33.882 };

const emptyFeatures = { type: "FeatureCollection", features: [] };

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

function formatBurnRisk(minutes) {
  return minutes === null || minutes === undefined ? "No burn risk" : `${Math.round(minutes)} min`;
}

function formatUvDoseChange(percent) {
  const rounded = Math.round(percent);
  return rounded < 0 ? `${Math.abs(rounded)}% more UV dose` : `${rounded}% lower UV dose`;
}

function demoRouteResponse(hour) {
  const intensity = 1 - Math.min(Math.abs(hour - 14) / 8, 0.72);
  const reduction = Math.round(42 + intensity * 29);
  const addedTime = Math.round(150 + intensity * 110);
  return {
    routes: [
      { type: "fastest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.1962, -33.89065], [151.19415, -33.8895], [151.19215, -33.8879], [151.1902, -33.887]] }, distance_m: 890, duration_s: 720, exposed_m: 630, exposed_frac: 0.71 },
      { type: "coolest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.19745, -33.8898], [151.19625, -33.88825], [151.19465, -33.88725], [151.1927, -33.88655], [151.1902, -33.887]] }, distance_m: 1110, duration_s: 720 + addedTime, exposed_m: 630 * (1 - reduction / 100), exposed_frac: 0.71 * (1 - reduction / 100) },
    ],
    comparison: { extra_distance_m: 220, extra_duration_s: addedTime, exposure_reduction_m: 630 * reduction / 100, exposure_reduction_pct: reduction },
    meta: { hour, shade_preference: 0.8, timezone: "Australia/Sydney" },
  };
}

function demoUvDose(hour) {
  const daylight = hour >= FIRST_LIT_HOUR && hour <= LAST_LIT_HOUR;
  return {
    uv: { hour, uv_index: daylight ? 5.4 : 0, source: "clear-sky model", is_live: false, observed_at: null },
    fastest_sed: daylight ? 0.67 : 0,
    coolest_sed: daylight ? 0.59 : 0,
    uv_reduction_sed: daylight ? 0.08 : 0,
    uv_reduction_pct: daylight ? 11.9 : 0,
    fastest_minutes_to_burn: daylight ? 43 : null,
    coolest_minutes_to_burn: daylight ? 49 : null,
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
  features: [[151.1971, -33.89025], [151.196, -33.8887], [151.1952, -33.88785], [151.1935, -33.88715], [151.1923, -33.8869], [151.1913, -33.88755]].map((coordinates, index) => ({ type: "Feature", properties: { id: `canopy-${index}`, crown_radius_m: 4 }, geometry: { type: "Point", coordinates } })),
};

function routeFeatures(response) {
  return { type: "FeatureCollection", features: response.routes.map((route) => ({ type: "Feature", properties: { routeType: route.type }, geometry: route.geometry })) };
}

function endpoints(origin) {
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } },
    { type: "Feature", properties: { kind: "destination" }, geometry: { type: "Point", coordinates: [DEMO_DESTINATION.lon, DEMO_DESTINATION.lat] } },
  ] };
}

function routeRequest(origin, hour) {
  return { origin, destination: DEMO_DESTINATION, hour, shade_preference: 0.8 };
}

async function postRouteResource(path, origin, hour, signal) {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(routeRequest(origin, hour)), signal });
  if (!response.ok) throw new Error("Route service is unavailable.");
  return response.json();
}

const shadowCache = new Map();

async function fetchShadowsCached(hour, signal) {
  if (shadowCache.has(hour)) return shadowCache.get(hour);
  const data = await fetchShadows(hour, signal);
  shadowCache.set(hour, data);
  return data;
}

function fetchRoute(origin, hour, signal) {
  return postRouteResource("/api/route", origin, hour, signal);
}

function fetchUvDose(origin, hour, signal) {
  return postRouteResource("/api/uv-dose", origin, hour, signal);
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

function App() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  // null means "follow the clock". Any number means the user has scrubbed the
  // slider and we show that hour instead until they hand control back.
  const [scrubbedHour, setScrubbedHour] = useState(null);
  const [position, setPosition] = useState(DEMO_ORIGIN);
  const [isTracking, setIsTracking] = useState(false);
  const [routeData, setRouteData] = useState(() => demoRouteResponse(serviceHour()));
  const [shadowData, setShadowData] = useState(() => demoShadows(serviceHour()));
  const [uvDose, setUvDose] = useState(() => demoUvDose(serviceHour()));
  const [canopyData, setCanopyData] = useState(demoCanopies);
  const canopyDataRef = useRef(demoCanopies);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingDemoData, setIsUsingDemoData] = useState(true);
  const [serviceMessage, setServiceMessage] = useState("Preparing the demo route.");
  const liveHour = serviceHour(now);
  const hour = scrubbedHour ?? liveHour;
  const isScrubbing = scrubbedHour !== null;
  const fastestRoute = routeData.routes.find((route) => route.type === "fastest");
  const coolestRoute = routeData.routes.find((route) => route.type === "coolest");
  const shadeCoverage = Math.round((1 - coolestRoute.exposed_frac) * 100);
  const addedMinutes = formatMinutes(routeData.comparison.extra_duration_s);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const map = new maplibregl.Map({ container: mapContainer.current, style: MAP_STYLE, center: [151.1943, -33.8887], zoom: 15.7, pitch: 42, bearing: -18, attributionControl: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
    map.on("load", () => {
      // The light basemap remains calm, while buildings get enough definition to be legible at a glance.
      map.getStyle().layers
        .filter((layer) => layer.type === "fill" && /building|structure/i.test(layer.id))
        .forEach((layer) => {
          map.setPaintProperty(layer.id, "fill-color", "#b6c1bb");
          map.setPaintProperty(layer.id, "fill-outline-color", "#77877f");
          map.setPaintProperty(layer.id, "fill-opacity", 0.98);
        });
      map.addSource("shadows", { type: "geojson", data: demoShadows(serviceHour()) });
      map.addLayer({ id: "shadow-fill", type: "fill", source: "shadows", paint: { "fill-color": "#3e5257", "fill-opacity": 0.22, "fill-antialias": true } });
      map.addLayer({ id: "shadow-soft-edge", type: "line", source: "shadows", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#526d72", "line-width": 3, "line-opacity": 0.18, "line-blur": 2.2 } });
      map.addSource("canopies", { type: "geojson", data: canopyDataRef.current });
      // Tree shade is deliberately a soft light-green pool, separate from the
      // cooler charcoal geometry used for building shadows above.
      map.addLayer({ id: "canopy-shade", type: "circle", source: "canopies", paint: { "circle-radius": ["interpolate", ["linear"], ["get", "crown_radius_m"], 2, 16, 8, 32], "circle-color": "#88cf9d", "circle-opacity": 0.31, "circle-blur": 0.96 } });
      map.addImage("tree-marker", createTreeMarker(), { pixelRatio: 2 });
      map.addLayer({ id: "tree-marker", type: "symbol", source: "canopies", layout: { "icon-image": "tree-marker", "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.42, 16, 0.6], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport" } });
      map.addSource("routes", { type: "geojson", data: routeFeatures(demoRouteResponse(serviceHour())) });
      map.addLayer({ id: "fastest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "fastest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d68a43", "line-width": 4, "line-opacity": 0.82 } });
      map.addLayer({ id: "coolest-route-outline", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.92 } });
      map.addLayer({ id: "coolest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#157167", "line-width": 6, "line-opacity": 1 } });
      map.addSource("endpoints", { type: "geojson", data: endpoints(DEMO_ORIGIN) });
      map.addLayer({ id: "endpoint-halo", type: "circle", source: "endpoints", filter: ["==", ["get", "kind"], "origin"], paint: { "circle-radius": 14, "circle-color": "#157167", "circle-opacity": 0.15 } });
      map.addLayer({ id: "endpoints", type: "circle", source: "endpoints", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "origin"], 7, 8], "circle-color": ["case", ["==", ["get", "kind"], "origin"], "#ffffff", "#157167"], "circle-stroke-color": "#17302f", "circle-stroke-width": 2 } });
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const [nextRoutes, nextShadows, nextUvDose] = await Promise.all([
          fetchRoute(position, hour, controller.signal),
          fetchShadowsCached(hour, controller.signal).catch(() => demoShadows(hour)),
          fetchUvDose(position, hour, controller.signal).catch(() => demoUvDose(hour)),
        ]);
        if (controller.signal.aborted) return;
        setRouteData(nextRoutes); setShadowData(nextShadows); setUvDose(nextUvDose); setIsUsingDemoData(false); setServiceMessage(isTracking ? "Live location is updating your route." : "Route estimate updated from the service.");
      } catch {
        if (controller.signal.aborted) return;
        setRouteData(demoRouteResponse(hour)); setShadowData(demoShadows(hour)); setUvDose(demoUvDose(hour)); setIsUsingDemoData(true); setServiceMessage(isTracking ? "Outside the demo area — showing the prepared Sydney route." : "Showing the prepared Sydney route.");
      } finally { if (!controller.signal.aborted) setIsLoading(false); }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [position, hour, isTracking]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrees(controller.signal)
      .then((trees) => { if (trees.features?.length) setCanopyData(mapCanopySample(trees)); })
      .catch(() => { /* The small fallback set keeps the map legible offline. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    canopyDataRef.current = canopyData;
    if (!map) return;

    // Do NOT early-return while the style loads: this effect only re-runs when
    // its data changes, so an update that arrives mid-load is dropped forever
    // and the map keeps its placeholder layer. Defer to the next idle instead.
    const apply = () => {
      map.getSource("routes")?.setData(routeFeatures(routeData));
      map.getSource("shadows")?.setData(shadowData);
      map.getSource("canopies")?.setData(canopyData);
      map.getSource("endpoints")?.setData(endpoints(position));
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("idle", apply);
    return () => map.off("idle", apply);
  }, [routeData, shadowData, canopyData, position]);

  useEffect(() => {
    if (!isTracking) return undefined;
    if (!navigator.geolocation) { setServiceMessage("This browser does not support location tracking."); setIsTracking(false); return undefined; }
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => { setPosition({ lat: coords.latitude, lon: coords.longitude }); setServiceMessage("Live location is updating your route."); },
      () => { setServiceMessage("Location permission was not granted — staying on the demo route."); setIsTracking(false); },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTracking]);

  function toggleTracking() {
    if (isTracking) { setIsTracking(false); setPosition(DEMO_ORIGIN); setServiceMessage("Live tracking paused. Back on the demo route."); return; }
    setServiceMessage("Requesting your location…");
    setIsTracking(true);
  }

  return <main className="app-shell">
    <div ref={mapContainer} className="map" aria-label="Interactive Shadeney route map" />
    <div className="map-wash" aria-hidden="true" />
    <header className="brand-panel"><div className="brand-mark" aria-hidden="true">S</div><div><p className="eyebrow">Sydney shade navigation</p><h1>Shadeney</h1></div></header>
    <section className="journey-card" aria-label="Destination"><p className="journey-label">Destination</p><div className="journey-row"><span className={`journey-dot ${isTracking ? "live" : ""}`} aria-hidden="true" /><p><strong>{isTracking ? "Your live location" : "Redfern Station"}</strong><small>{isTracking ? "GPS tracking active" : "Demo start"}</small></p></div><div className="journey-line" aria-hidden="true" /><div className="journey-row"><span className="journey-dot destination" aria-hidden="true" /><p><strong>University of Sydney</strong><small>Destination</small></p></div></section>
    <section className="route-key" aria-label="Map legend"><span><i className="route-swatch fastest" aria-hidden="true" />Fastest</span><span><i className="route-swatch coolest" aria-hidden="true" />More shade</span><span><i className="tree-swatch" aria-hidden="true" />Canopy</span></section>
    <button className={`tracking-button ${isTracking ? "is-active" : ""}`} type="button" onClick={toggleTracking}><span className="tracking-dot" aria-hidden="true" />{isTracking ? "Pause live tracking" : "Start live tracking"}</button>
    <section className="navigation-panel" aria-label="Live route details">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-heading"><div><p className="panel-kicker">Live shade route</p><h2>{shadeCoverage}% <span>shaded</span></h2><p className="panel-subtitle">{isScrubbing ? `Shade at ${formatHourLabel(hour)}` : isDaylight(now) ? `Sun estimate for ${formatClock(now)}` : `Outside daylight — previewing ${formatHourLabel(hour)}`}</p></div><div className="route-duration"><strong>{formatMinutes(coolestRoute.duration_s)}</strong><span>{Math.round(coolestRoute.distance_m / 100) / 10} km</span></div></div>
      <div className="route-cards" aria-label="Route comparison"><article className="route-card recommended"><div className="route-card-icon" aria-hidden="true">☂</div><div className="route-card-copy"><p>More shade</p><strong>{addedMinutes} longer · {Math.round(routeData.comparison.exposure_reduction_pct)}% less sun</strong><div className="exposure-meter" aria-label={`${shadeCoverage}% of the recommended route is shaded`}><span style={{ width: `${shadeCoverage}%` }} /></div></div><span className="recommended-tag">Best match</span></article><article className="route-card"><div className="route-card-icon warm" aria-hidden="true">☀</div><div className="route-card-copy"><p>Fastest</p><strong>{formatMinutes(fastestRoute.duration_s)} · more sun</strong><div className="exposure-meter warm-meter" aria-label="The fastest route has higher direct sun exposure"><span /></div></div></article></div>
      <section className="uv-summary" aria-label="UV dose estimate"><div><p>UV {uvDose.uv.uv_index.toFixed(1)} <span className={`uv-badge ${uvDose.uv.is_live ? "is-live" : ""}`}>{uvDose.uv.is_live ? "Live" : "Estimated"}</span></p><strong>{formatBurnRisk(uvDose.fastest_minutes_to_burn)} <i>→</i> {formatBurnRisk(uvDose.coolest_minutes_to_burn)}</strong><small>Time to burn · fair skin</small></div><p className="uv-change">{formatUvDoseChange(uvDose.uv_reduction_pct)}</p></section>
      <div className="time-scrubber">
        <div className="scrubber-head">
          <span>Time of day</span>
          <strong>{formatHourLabel(hour)}</strong>
        </div>
        <input
          className="scrubber-input"
          type="range"
          min={FIRST_LIT_HOUR}
          max={LAST_LIT_HOUR}
          step={1}
          value={hour}
          onChange={(event) => setScrubbedHour(Number(event.target.value))}
          aria-label="Time of day for the shade model"
        />
        <div className="scrubber-scale" aria-hidden="true">
          <span>{formatHourLabel(FIRST_LIT_HOUR)}</span>
          <span>{formatHourLabel(12)}</span>
          <span>{formatHourLabel(LAST_LIT_HOUR)}</span>
        </div>
        {isScrubbing ? (
          <button type="button" className="scrubber-reset" onClick={() => setScrubbedHour(null)}>
            Back to now
          </button>
        ) : null}
      </div>
      <div className="live-strip"><span className={`live-indicator ${isTracking ? "is-live" : ""}`} aria-hidden="true" /> <strong>{isTracking ? "Tracking your location" : "Demo navigation"}</strong><span>{isLoading ? "Updating…" : "Refreshes as you move"}</span></div>
      <p className={`service-note ${isUsingDemoData ? "is-demo" : ""}`} role="status">{serviceMessage}</p>
    </section>
    <p className="map-credit">Map data © OpenStreetMap contributors · Tree data © City of Sydney (CC BY 4.0)</p>
  </main>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
