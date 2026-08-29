import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main>
      <section className="card">
        <p className="eyebrow">SYNCS HACK 2026</p>
        <h1>Shadeney</h1>
        <p>Compare the fastest walk with a route that has less estimated direct sun.</p>
        <p className="status">Frontend map integration belongs to Lane D.</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode><App /></React.StrictMode>
);
