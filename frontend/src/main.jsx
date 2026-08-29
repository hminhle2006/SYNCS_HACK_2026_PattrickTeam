import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const API_BASE_URL = "http://localhost:8000";
const DEMO_ORIGIN = { lat: -33.8913, lon: 151.198 };
const DEMO_DESTINATION = { lat: -33.887, lon: 151.1902 };
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

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

function endpoints(origin) {
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } },
    { type: "Feature", properties: { kind: "destination" }, geometry: { type: "Point", coordinates: [DEMO_DESTINATION.lon, DEMO_DESTINATION.lat] } },
  ] };
}

async function fetchRoute(origin, hour, signal) {
  const response = await fetch(`${API_BASE_URL}/api/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin, destination: DEMO_DESTINATION, hour, shade_preference: 0.8 }), signal });
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

async function fetchShadows(hour, signal) {
  const response = await fetch(`${API_BASE_URL}/api/shadows?hour=${hour}`, { signal });
  if (!response.ok) throw new Error("Shadow service is unavailable.");
  return response.json();
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
      map.addSource("shadows", { type: "geojson", data: demoShadows(serviceHour()) });
      map.addLayer({ id: "shadow-fill", type: "fill", source: "shadows", paint: { "fill-color": "#3d5a63", "fill-opacity": 0.34 } });
      map.addLayer({ id: "shadow-outline", type: "line", source: "shadows", paint: { "line-color": "#5d8189", "line-width": 1, "line-opacity": 0.5 } });
      map.addSource("canopies", { type: "geojson", data: demoCanopies });
      map.addLayer({ id: "canopy-halo", type: "circle", source: "canopies", paint: { "circle-radius": 11, "circle-color": "#5da47b", "circle-opacity": 0.12 } });
      map.addLayer({ id: "canopy-core", type: "circle", source: "canopies", paint: { "circle-radius": 4, "circle-color": "#34745a", "circle-stroke-width": 2, "circle-stroke-color": "#eaf6ee" } });
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
        const [nextRoutes, nextShadows] = await Promise.all([fetchRoute(position, hour, controller.signal), fetchShadowsCached(hour, controller.signal).catch(() => demoShadows(hour))]);
        if (controller.signal.aborted) return;
        setRouteData(nextRoutes); setShadowData(nextShadows); setIsUsingDemoData(false); setServiceMessage(isTracking ? "Live location is updating your route." : "Route estimate updated from the service.");
      } catch {
        if (controller.signal.aborted) return;
        setRouteData(demoRouteResponse(hour)); setShadowData(demoShadows(hour)); setIsUsingDemoData(true); setServiceMessage(isTracking ? "Outside the demo area — showing the prepared Sydney route." : "Showing the prepared Sydney route.");
      } finally { if (!controller.signal.aborted) setIsLoading(false); }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [position, hour, isTracking]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Returning early when the style is still loading silently DROPS the
    // update: this effect only re-runs when its data changes, so the payload
    // that arrived during style load is never applied and the map keeps its
    // placeholder layer forever. Shadow data resolves fast (and is cached),
    // so it routinely lost this race -- which is why the real overlay never
    // appeared. Defer to the next idle instead of giving up.
    const apply = () => {
      map.getSource("routes")?.setData(routeFeatures(routeData));
      map.getSource("shadows")?.setData(shadowData);
      map.getSource("endpoints")?.setData(endpoints(position));
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }
    map.once("idle", apply);
    return () => map.off("idle", apply);
  }, [routeData, shadowData, position]);

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
