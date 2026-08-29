import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const API_BASE_URL = "http://localhost:8000";
const DEMO_REQUEST = {
  origin: { lat: -33.8913, lon: 151.198 },
  destination: { lat: -33.887, lon: 151.1902 },
  shade_preference: 0.8,
};
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function formatHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:00 ${suffix}`;
}

function formatMinutes(seconds) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function demoRouteResponse(hour) {
  const sunIntensity = 1 - Math.min(Math.abs(hour - 14) / 8, 0.72);
  const exposureReductionPct = Math.round(42 + sunIntensity * 29);
  const extraDuration = Math.round(150 + sunIntensity * 110);
  return {
    routes: [
      { type: "fastest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.1962, -33.89065], [151.19415, -33.8895], [151.19215, -33.8879], [151.1902, -33.887]] }, distance_m: 890, duration_s: 720, exposed_m: 630, exposed_frac: 0.71 },
      { type: "coolest", geometry: { type: "LineString", coordinates: [[151.198, -33.8913], [151.19745, -33.8898], [151.19625, -33.88825], [151.19465, -33.88725], [151.1927, -33.88655], [151.1902, -33.887]] }, distance_m: 1110, duration_s: 720 + extraDuration, exposed_m: 630 * (1 - exposureReductionPct / 100), exposed_frac: 0.71 * (1 - exposureReductionPct / 100) },
    ],
    comparison: { extra_distance_m: 220, extra_duration_s: extraDuration, exposure_reduction_m: 630 * (exposureReductionPct / 100), exposure_reduction_pct: exposureReductionPct },
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
  return { type: "FeatureCollection", features: polygons.map((coordinates, index) => ({ type: "Feature", properties: { id: `demo-shadow-${index}` }, geometry: { type: "Polygon", coordinates: [coordinates] } })) };
}

function toRouteFeatures(routeResponse) {
  return { type: "FeatureCollection", features: routeResponse.routes.map((route) => ({ type: "Feature", properties: { routeType: route.type }, geometry: route.geometry })) };
}

async function fetchRoute(hour, signal) {
  const response = await fetch(`${API_BASE_URL}/api/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...DEMO_REQUEST, hour }), signal });
  if (!response.ok) throw new Error("Route service is unavailable.");
  return response.json();
}

async function fetchShadows(hour, signal) {
  const response = await fetch(`${API_BASE_URL}/api/shadows?hour=${hour}`, { signal });
  if (!response.ok) throw new Error("Shadow service is unavailable.");
  return response.json();
}

function App() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [hour, setHour] = useState(14);
  const [routeData, setRouteData] = useState(() => demoRouteResponse(14));
  const [shadowData, setShadowData] = useState(() => demoShadows(14));
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingDemoData, setIsUsingDemoData] = useState(true);
  const [serviceMessage, setServiceMessage] = useState("Preparing your Sydney walk.");
  const comparisonLabel = useMemo(() => `${formatMinutes(routeData.comparison.extra_duration_s)} longer · ${Math.round(routeData.comparison.exposure_reduction_pct)}% less sun`, [routeData]);
  const fastestRoute = routeData.routes.find((route) => route.type === "fastest");
  const coolestRoute = routeData.routes.find((route) => route.type === "coolest");
  const shadeCoverage = Math.round((1 - coolestRoute.exposed_frac) * 100);

  useEffect(() => {
    const map = new maplibregl.Map({ container: mapContainer.current, style: MAP_STYLE, center: [151.1943, -33.8887], zoom: 15.2, pitch: 34, bearing: -16, attributionControl: true });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
    map.on("load", () => {
      map.addSource("shadows", { type: "geojson", data: demoShadows(14) });
      map.addLayer({ id: "shadow-fill", type: "fill", source: "shadows", paint: { "fill-color": "#56747a", "fill-opacity": 0.18 } });
      map.addSource("routes", { type: "geojson", data: toRouteFeatures(demoRouteResponse(14)) });
      map.addLayer({ id: "fastest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "fastest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#E8833A", "line-width": 4, "line-opacity": 0.7 } });
      map.addLayer({ id: "coolest-route-outline", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FAFAF8", "line-width": 10, "line-opacity": 0.9 } });
      map.addLayer({ id: "coolest-route", type: "line", source: "routes", filter: ["==", ["get", "routeType"], "coolest"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2D6A6F", "line-width": 6, "line-opacity": 1 } });
      map.addSource("route-endpoints", { type: "geojson", data: { type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "start" }, geometry: { type: "Point", coordinates: [151.198, -33.8913] } }, { type: "Feature", properties: { kind: "end" }, geometry: { type: "Point", coordinates: [151.1902, -33.887] } }] } });
      map.addLayer({ id: "route-endpoints", type: "circle", source: "route-endpoints", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "start"], 6, 8], "circle-color": ["case", ["==", ["get", "kind"], "start"], "#FAFAF8", "#2D6A6F"], "circle-stroke-color": "#1A1A1A", "circle-stroke-width": 2 } });
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const debounce = window.setTimeout(async () => {
      setIsLoading(true);
      setServiceMessage("Updating shade estimates…");
      try {
        const [nextRoutes, nextShadows] = await Promise.all([fetchRoute(hour, controller.signal), fetchShadows(hour, controller.signal).catch(() => demoShadows(hour))]);
        if (controller.signal.aborted) return;
        setRouteData(nextRoutes); setShadowData(nextShadows); setIsUsingDemoData(false); setServiceMessage("Estimated using the latest route service.");
      } catch (error) {
        if (controller.signal.aborted) return;
        setRouteData(demoRouteResponse(hour)); setShadowData(demoShadows(hour)); setIsUsingDemoData(true); setServiceMessage("Route service is unavailable — showing the prepared demo walk.");
      } finally { if (!controller.signal.aborted) setIsLoading(false); }
    }, 150);
    return () => { controller.abort(); window.clearTimeout(debounce); };
  }, [hour]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.getSource("routes")?.setData(toRouteFeatures(routeData));
    map.getSource("shadows")?.setData(shadowData);
  }, [routeData, shadowData]);

  function resetDemo() {
    setHour(14);
    mapRef.current?.flyTo({ center: [151.1943, -33.8887], zoom: 15.2, pitch: 34, bearing: -16, duration: 700 });
  }

  return <main className="app-shell">
    <div ref={mapContainer} className="map" aria-label="Interactive map of the Shadeney Sydney demo route" />
    <div className="map-wash" aria-hidden="true" />
    <header className="brand-panel"><div className="brand-mark" aria-hidden="true">S</div><div><p className="eyebrow">Shade-aware walking</p><h1>Shadeney</h1></div></header>
    <section className="journey-card" aria-label="Demo journey"><p className="journey-label">Today’s demo walk</p><div className="journey-row"><span className="journey-dot origin" aria-hidden="true" /><p><strong>Redfern Station</strong><small>Start</small></p></div><div className="journey-line" aria-hidden="true" /><div className="journey-row"><span className="journey-dot destination" aria-hidden="true" /><p><strong>University of Sydney</strong><small>Destination</small></p></div></section>
    <section className="route-key" aria-label="Route legend"><span><i className="route-swatch fastest" aria-hidden="true" />Fastest</span><span><i className="route-swatch coolest" aria-hidden="true" />More shade</span></section>
    <button className="try-it" type="button" onClick={resetDemo}><span aria-hidden="true">↻</span> Reset demo</button>
    <section className="time-panel" aria-label="Choose the time for the route estimate">
      <div className="sheet-handle" aria-hidden="true" />
      <div className="sheet-heading"><div><p className="panel-kicker">Your cooler walk</p><h2>{shadeCoverage}% <span>shaded</span></h2><p className="panel-subtitle">Recommended at {formatHour(hour)}</p></div><div className="route-duration"><strong>{formatMinutes(coolestRoute.duration_s)}</strong><span>{Math.round(coolestRoute.distance_m / 100) / 10} km</span></div></div>
      <div className="route-cards" aria-label="Route comparison"><article className="route-card recommended"><div className="route-card-icon" aria-hidden="true">☂</div><div className="route-card-copy"><p>More shade</p><strong>{comparisonLabel}</strong><div className="exposure-meter" aria-label={`${shadeCoverage}% of the recommended route is shaded`}><span style={{ width: `${shadeCoverage}%` }} /></div></div><span className="recommended-tag">Best match</span></article><article className="route-card"><div className="route-card-icon warm" aria-hidden="true">☀</div><div className="route-card-copy"><p>Fastest</p><strong>{formatMinutes(fastestRoute.duration_s)} · more sun</strong><div className="exposure-meter warm-meter" aria-label="The fastest route has higher direct sun exposure"><span /></div></div></article></div>
      <div className="slider-heading"><span>Sun position</span><strong>{formatHour(hour)}</strong></div>
      <div className="time-scale" aria-hidden="true"><span>6am</span><span>7pm</span></div>
      <label htmlFor="sun-time" className="sr-only">Time of day</label>
      <input id="sun-time" type="range" min="6" max="19" step="1" value={hour} onChange={(event) => setHour(Number(event.target.value))} aria-valuetext={formatHour(hour)} />
      <p className={`service-note ${isUsingDemoData ? "is-demo" : ""}`} role="status">{isLoading ? "Updating shade estimates…" : serviceMessage}</p>
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
