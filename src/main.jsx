import React from "react";
import { createRoot } from "react-dom/client";
import App from "./grocery-app.jsx";
import "./ui/tokens.css";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
