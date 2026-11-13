import React from "react";
import { createRoot } from "react-dom/client";
import App from "./grocery-app.jsx";
import "./ui/tokens.css";
import "./index.css";

// The fallback build (polish cutover): the `v1-final` tag is published at /v1/ with
// VITE_LEGACY=1, on the LIVE storage keys, so the old app can be reopened on real data
// for a few weeks after the new one goes live. This banner says which app is open.
const IS_LEGACY = !!import.meta.env.VITE_LEGACY;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {IS_LEGACY && (
      <div role="note" style={{ background:"#A8520A", color:"#FFFFFF", fontSize:12, fontWeight:700, padding:"6px 12px", textAlign:"center" }}>
        Old version (fallback). Same data as the new app; don't edit in both at once.
      </div>
    )}
    <App />
  </React.StrictMode>
);
