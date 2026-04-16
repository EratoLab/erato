import "@erato/frontend/library.css";
import { componentRegistry } from "@erato/frontend/library";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import { injectFrontendEnv } from "./app/env";
import { AddinFileSourceSelector } from "./components/AddinFileSourceSelector";
import { OutlookEratoEmailRenderer } from "./components/OutlookEratoEmailRenderer";
import { AddinSetupPage } from "./pages/AddinSetupPage";

injectFrontendEnv();

componentRegistry.ChatFileSourceSelector = AddinFileSourceSelector;
componentRegistry.EratoEmailCodeBlock = OutlookEratoEmailRenderer;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/office-addin">
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/setup" element={<AddinSetupPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
