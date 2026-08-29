import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // MapLibre parses vector tiles in a web worker. Vite's dependency
  // pre-bundling rewrites the import but does not emit
  // maplibre-gl-worker.mjs, so the worker 404s, no tile is ever parsed, and
  // the map stays black -- with no console error, because MapLibre swallows
  // the worker failure. Excluding it from pre-bundling makes Vite serve the
  // package as-is, so its own worker URL resolves.
  optimizeDeps: { exclude: ["maplibre-gl"] },
});
