import "@erato/frontend/library.css";
import { componentRegistry } from "@erato/frontend/library";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import { injectFrontendEnv } from "./app/env";
import { AddinChatAddMenuExtraContent } from "./components/AddinChatAddMenuExtraContent";
import { OutlookEratoEmailRenderer } from "./components/OutlookEratoEmailRenderer";
import { AddinSetupRoute } from "./pages/AddinSetupPage";

injectFrontendEnv();

// The add-in's email-content sources ride into the shared "+" menu via the
// ChatAddMenuExtraContent slot; file sources and tools come from the core menu.
componentRegistry.ChatAddMenuExtraContent = AddinChatAddMenuExtraContent;
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
        <Route path="/setup" element={<AddinSetupRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
