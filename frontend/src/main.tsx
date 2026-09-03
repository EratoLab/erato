import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import AppRoutes from "./App"; // App.tsx now exports AppRoutes
import { applyComponentKitRegistrations } from "./config/componentRegistry";
import { initE2EOverrides } from "./config/componentRegistryE2E";
import "./styles/globals.css"; // Corrected path to global stylesheet

// Import Geist fonts
import "non.geist"; // Imports Geist Sans Variable
import "non.geist/mono"; // Imports Geist Mono Variable

const startApp = async (): Promise<void> => {
  // Kit scripts have executed by now (document order); pick up their
  // registrations, which land after the registry module evaluates.
  applyComponentKitRegistrations();

  // The example implementations are imported only when an E2E run requests
  // them. Production previously paid for their full dependency graph despite
  // this function being a no-op there.
  await initE2EOverrides();

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
};

void startApp();
