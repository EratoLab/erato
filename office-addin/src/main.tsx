import "@erato/frontend/library.css";
import {
  applyComponentKitRegistrations,
  componentRegistry,
} from "@erato/frontend/library";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import { injectFrontendEnv } from "./app/env";
import { AddinChatAddMenuExtraContent } from "./components/AddinChatAddMenuExtraContent";
import { OutlookEratoAppointmentRenderer } from "./components/OutlookEratoAppointmentRenderer";
import { OutlookEratoEmailRenderer } from "./components/OutlookEratoEmailRenderer";
import { AddinSetupRoute } from "./pages/AddinSetupPage";

injectFrontendEnv();

// Kit scripts have executed by now (document order); pick up their
// registrations before stacking the add-in's own slot assignments on top.
applyComponentKitRegistrations();

// The add-in's email-content sources ride into the shared "+" menu via the
// ChatAddMenuExtraContent slot; file sources and tools come from the core menu.
componentRegistry.ChatAddMenuExtraContent = AddinChatAddMenuExtraContent;
componentRegistry.EratoEmailCodeBlock = OutlookEratoEmailRenderer;
componentRegistry.EratoAppointmentCodeBlock = OutlookEratoAppointmentRenderer;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/office-addin">
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/setup" element={<AddinSetupRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
