import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import AppRoutes from "./App"; // App.tsx now exports AppRoutes
import { initE2EOverrides } from "./config/componentRegistryE2E";
import "./styles/globals.css"; // Corrected path to global stylesheet

// Import Geist fonts
import "non.geist"; // Imports Geist Sans Variable
import "non.geist/mono"; // Imports Geist Mono Variable

// Apply E2E / dev example overrides (no-op in production)
initE2EOverrides();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </React.StrictMode>,
);
