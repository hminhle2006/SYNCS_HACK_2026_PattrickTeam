import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const API_BASE_URL = "http://localhost:8000";
const DEMO_ORIGIN = { lat: -33.8913, lon: 151.198 };
const DEMO_DESTINATION = { lat: -33.887, lon: 151.1902 };
const DEMO_DESTINATIONS = [
  { name: "University of Sydney", detail: "Camperdown", lat: -33.887, lon: 151.1902 },
  { name: "Carriageworks", detail: "Eveleigh", lat: -33.8924, lon: 151.1915 },
  { name: "Victoria Park", detail: "Broadway, Camperdown", lat: -33.8847, lon: 151.1937 },
  { name: "Prince Alfred Park", detail: "Surry Hills", lat: -33.8908, lon: 151.2071 },
];
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

function estimateDistanceMeters(origin, destination) {
  const latitudeMeters = (destination.lat - origin.lat) * 111_320;
  const longitudeMeters = (destination.lon - origin.lon) * 111_320 * Math.cos(origin.lat * Math.PI / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

function demoRouteResponse(hour, destination = DEMO_DESTINATION) {
  const intensity = 1 - Math.min(Math.abs(hour - 14) / 8, 0.72);
  const reduction = Math.round(42 + intensity * 29);
  const addedTime = Math.round(150 + intensity * 110);
  const directDistance = estimateDistanceMeters(DEMO_ORIGIN, destination);
  const fastestDuration = Math.max(360, Math.round(directDistance / 1.28));
  const detour = destination.lon < DEMO_ORIGIN.lon ? -0.00055 : 0.00055;
  const fastestCoordinates = [
    [DEMO_ORIGIN.lon, DEMO_ORIGIN.lat],
    [DEMO_ORIGIN.lon + (destination.lon - DEMO_ORIGIN.lon) * 0.38, DEMO_ORIGIN.lat + (destination.lat - DEMO_ORIGIN.lat) * 0.34],
    [DEMO_ORIGIN.lon + (destination.lon - DEMO_ORIGIN.lon) * 0.7, DEMO_ORIGIN.lat + (destination.lat - DEMO_ORIGIN.lat) * 0.72],
    [destination.lon, destination.lat],
  ];
  const coolestCoordinates = [
    [DEMO_ORIGIN.lon, DEMO_ORIGIN.lat],
    [DEMO_ORIGIN.lon + detour, DEMO_ORIGIN.lat + (destination.lat - DEMO_ORIGIN.lat) * 0.26],
    [DEMO_ORIGIN.lon + (destination.lon - DEMO_ORIGIN.lon) * 0.46 + detour, DEMO_ORIGIN.lat + (destination.lat - DEMO_ORIGIN.lat) * 0.58],
    [DEMO_ORIGIN.lon + (destination.lon - DEMO_ORIGIN.lon) * 0.78 + detour * 0.35, DEMO_ORIGIN.lat + (destination.lat - DEMO_ORIGIN.lat) * 0.84],
    [destination.lon, destination.lat],
  ];
  return {
    routes: [
      { type: "fastest", geometry: { type: "LineString", coordinates: fastestCoordinates }, distance_m: Math.round(directDistance), duration_s: fastestDuration, exposed_m: directDistance * 0.71, exposed_frac: 0.71 },
      { type: "coolest", geometry: { type: "LineString", coordinates: coolestCoordinates }, distance_m: Math.round(directDistance + 220), duration_s: fastestDuration + addedTime, exposed_m: directDistance * 0.71 * (1 - reduction / 100), exposed_frac: 0.71 * (1 - reduction / 100) },
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

function endpoints(origin, destination = DEMO_DESTINATION) {
  return { type: "FeatureCollection", features: [
    { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: [origin.lon, origin.lat] } },
    { type: "Feature", properties: { kind: "destination" }, geometry: { type: "Point", coordinates: [destination.lon, destination.lat] } },
  ] };
}

function routeRequest(origin, destination, hour) {
  return { origin, destination, hour, shade_preference: 0.8 };
}

async function postRouteResource(path, origin, destination, hour, signal) {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(routeRequest(origin, destination, hour)), signal });
  if (!response.ok) throw new Error("Route service is unavailable.");
  return response.json();
}

function fetchRoute(origin, destination, hour, signal) {
  return postRouteResource("/api/route", origin, destination, hour, signal);
}

function fetchUvDose(origin, destination, hour, signal) {
  return postRouteResource("/api/uv-dose", origin, destination, hour, signal);
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
  const [position, setPosition] = useState(DEMO_ORIGIN);
  const [destination, setDestination] = useState(DEMO_DESTINATIONS[0]);
  const [searchText, setSearchText] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [routeData, setRouteData] = useState(() => demoRouteResponse(serviceHour(), DEMO_DESTINATIONS[0]));
  const [shadowData, setShadowData] = useState(() => demoShadows(serviceHour()));
  const [uvDose, setUvDose] = useState(() => demoUvDose(serviceHour()));
  const [canopyData, setCanopyData] = useState(demoCanopies);
  const canopyDataRef = useRef(demoCanopies);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingDemoData, setIsUsingDemoData] = useState(true);
  const [serviceMessage, setServiceMessage] = useState("Preparing the demo route.");
  const hour = serviceHour(now);
  const fastestRoute = routeData.routes.find((route) => route.type === "fastest");
  const coolestRoute = routeData.routes.find((route) => route.type === "coolest");
  const shadeCoverage = Math.round((1 - coolestRoute.exposed_frac) * 100);
  const addedMinutes = formatMinutes(routeData.comparison.extra_duration_s);
  const searchResults = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return DEMO_DESTINATIONS;
    return DEMO_DESTINATIONS.filter((place) => `${place.name} ${place.detail}`.toLowerCase().includes(query));
  }, [searchText]);

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
      // Individual trees fade into the canopy at overview zooms, then become
      // clear as the walker zooms in. They never vanish entirely, so the map
      // retains a soft sense of green cover at every scale.
      map.addLayer({ id: "tree-marker", type: "symbol", source: "canopies", layout: { "icon-image": "tree-marker", "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.28, 15.25, 0.46, 16, 0.6], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "viewport" }, paint: { "icon-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.12, 14.5, 0.32, 15.25, 0.65, 16, 1] } });
      map.addSource("routes", { type: "geojson", data: routeFeatures(demoRouteResponse(serviceHour(), DEMO_DESTINATIONS[0])) });
      map.addLayer({ id: "fastest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "fastest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d68a43", "line-width": 4, "line-opacity": 0.82 } });
      map.addLayer({ id: "coolest-route-outline", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.92 } });
      map.addLayer({ id: "coolest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#157167", "line-width": 6, "line-opacity": 1 } });
      map.addSource("endpoints", { type: "geojson", data: endpoints(DEMO_ORIGIN, DEMO_DESTINATIONS[0]) });
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
          fetchRoute(position, destination, hour, controller.signal),
          fetchShadows(hour, controller.signal).catch(() => demoShadows(hour)),
          fetchUvDose(position, destination, hour, controller.signal).catch(() => demoUvDose(hour)),
        ]);
        if (controller.signal.aborted) return;
        setRouteData(nextRoutes); setShadowData(nextShadows); setUvDose(nextUvDose); setIsUsingDemoData(false); setServiceMessage(isTracking ? "Live location is updating your route." : "Route estimate updated from the service.");
      } catch {
        if (controller.signal.aborted) return;
        setRouteData(demoRouteResponse(hour, destination)); setShadowData(demoShadows(hour)); setUvDose(demoUvDose(hour)); setIsUsingDemoData(true); setServiceMessage(isTracking ? "Outside the demo area — showing the prepared Sydney route." : `Showing the prepared route to ${destination.name}.`);
      } finally { if (!controller.signal.aborted) setIsLoading(false); }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [position, destination, hour, isTracking]);

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
    if (!map || !map.isStyleLoaded()) return;
    map.getSource("routes")?.setData(routeFeatures(routeData));
    map.getSource("shadows")?.setData(shadowData);
    map.getSource("canopies")?.setData(canopyData);
    map.getSource("endpoints")?.setData(endpoints(position, destination));
  }, [routeData, shadowData, canopyData, position, destination]);

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

  function selectDestination(place) {
    setDestination(place);
    setSearchText(place.name);
    setIsSearchOpen(false);
    setServiceMessage(`Finding a shaded route to ${place.name}…`);
    mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 15.5, duration: 850, essential: true });
  }

  function submitSearch(event) {
    event.preventDefault();
    if (searchResults[0]) selectDestination(searchResults[0]);
  }

  return <main className="app-shell">
    <div ref={mapContainer} className="map" aria-label="Interactive Shadeney route map" />
    <div className="map-wash" aria-hidden="true" />
    <header className="brand-panel"><div className="brand-mark" aria-hidden="true">S</div><div><p className="eyebrow">Sydney shade navigation</p><h1>Shadeney</h1></div></header>
    <section className="search-panel" aria-label="Destination search"><form className="search-form" onSubmit={submitSearch}><span className="search-icon" aria-hidden="true">⌕</span><label className="sr-only" htmlFor="destination-search">Search a destination</label><input id="destination-search" value={searchText} onFocus={() => setIsSearchOpen(true)} onChange={(event) => { setSearchText(event.target.value); setIsSearchOpen(true); }} placeholder="Search a destination" autoComplete="off" /><button type="submit">Route</button></form>{isSearchOpen && <div className="search-results" role="listbox" aria-label="Sydney demo destinations">{searchResults.length ? searchResults.map((place) => <button key={place.name} type="button" className="search-result" role="option" onClick={() => selectDestination(place)}><span className="search-result-pin" aria-hidden="true">●</span><span><strong>{place.name}</strong><small>{place.detail}</small></span></button>) : <p className="search-empty">Try “University” or “Park”</p>}</div>}</section>
    <section className="journey-card" aria-label="Destination"><p className="journey-label">Destination</p><div className="journey-row"><span className={`journey-dot ${isTracking ? "live" : ""}`} aria-hidden="true" /><p><strong>{isTracking ? "Your live location" : "Redfern Station"}</strong><small>{isTracking ? "GPS tracking active" : "Demo start"}</small></p></div><div className="journey-line" aria-hidden="true" /><div className="journey-row"><span className="journey-dot destination" aria-hidden="true" /><p><strong>{destination.name}</strong><small>{destination.detail}</small></p></div></section>
    <section className="route-key" aria-label="Map legend"><span><i className="route-swatch fastest" aria-hidden="true" />Fastest</span><span><i className="route-swatch coolest" aria-hidden="true" />More shade</span><span><i className="tree-swatch" aria-hidden="true" />Canopy</span></section>
    <button className={`tracking-button ${isTracking ? "is-active" : ""}`} type="button" onClick={toggleTracking}><span className="tracking-dot" aria-hidden="true" />{isTracking ? "Pause live tracking" : "Start live tracking"}</button>
    <section className="navigation-panel" aria-label="Live route details">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-heading"><div><p className="panel-kicker">Live shade route</p><h2>{shadeCoverage}% <span>shaded</span></h2><p className="panel-subtitle">{isDaylight(now) ? `Sun estimate for ${formatClock(now)}` : `Outside daylight — previewing ${formatHourLabel(hour)}`}</p></div><div className="route-duration"><strong>{formatMinutes(coolestRoute.duration_s)}</strong><span>{Math.round(coolestRoute.distance_m / 100) / 10} km</span></div></div>
      <div className="route-cards" aria-label="Route comparison"><article className="route-card recommended"><div className="route-card-icon" aria-hidden="true">☂</div><div className="route-card-copy"><p>More shade</p><strong>{addedMinutes} longer · {Math.round(routeData.comparison.exposure_reduction_pct)}% less sun</strong><div className="exposure-meter" aria-label={`${shadeCoverage}% of the recommended route is shaded`}><span style={{ width: `${shadeCoverage}%` }} /></div></div><span className="recommended-tag">Best match</span></article><article className="route-card"><div className="route-card-icon warm" aria-hidden="true">☀</div><div className="route-card-copy"><p>Fastest</p><strong>{formatMinutes(fastestRoute.duration_s)} · more sun</strong><div className="exposure-meter warm-meter" aria-label="The fastest route has higher direct sun exposure"><span /></div></div></article></div>
      <section className="uv-summary" aria-label="UV dose estimate"><div><p>UV {uvDose.uv.uv_index.toFixed(1)} <span className={`uv-badge ${uvDose.uv.is_live ? "is-live" : ""}`}>{uvDose.uv.is_live ? "Live" : "Estimated"}</span></p><strong>{formatBurnRisk(uvDose.fastest_minutes_to_burn)} <i>→</i> {formatBurnRisk(uvDose.coolest_minutes_to_burn)}</strong><small>Time to burn · fair skin</small></div><p className="uv-change">{formatUvDoseChange(uvDose.uv_reduction_pct)}</p></section>
      <div className="live-strip"><span className={`live-indicator ${isTracking ? "is-live" : ""}`} aria-hidden="true" /> <strong>{isTracking ? "Tracking your location" : "Demo navigation"}</strong><span>{isLoading ? "Updating…" : "Refreshes as you move"}</span></div>
      <p className={`service-note ${isUsingDemoData ? "is-demo" : ""}`} role="status">{serviceMessage}</p>
    </section>
    <p className="map-credit">Map data © OpenStreetMap contributors · Tree data © City of Sydney (CC BY 4.0)</p>
  </main>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
