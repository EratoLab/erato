// Performance debugging tools - must be imported before React
import "./wdyr";

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { scan } from "react-scan";

import AppRoutes from "./App"; // App.tsx now exports AppRoutes
import "./styles/globals.css"; // Corrected path to global stylesheet

// Import Geist fonts
import "non.geist"; // Imports Geist Sans Variable
import "non.geist/mono"; // Imports Geist Mono Variable

// Initialize React Scan for visual re-render detection (development only)
if (process.env.NODE_ENV === "development") {
  scan({
    enabled: true,
    log: true, // Logs re-renders to console
  });
}

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
