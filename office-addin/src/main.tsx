import "@erato/frontend/library.css";
import "./styles.css";
import { applyComponentKitRegistrations } from "@erato/frontend/library";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { injectFrontendEnv } from "./app/env";
import { AddinSetupRoute } from "./pages/AddinSetupPage";

const OutlookApp = lazy(() => import("./outlook/OutlookApp"));

injectFrontendEnv();

// Kit scripts have executed by now (document order). Host routes add their
// own contributions synchronously when their lazy module is selected.
applyComponentKitRegistrations();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/office-addin">
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={null}>
              <OutlookApp />
            </Suspense>
          }
        />
        <Route path="/setup" element={<AddinSetupRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
