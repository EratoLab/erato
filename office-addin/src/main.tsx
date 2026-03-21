import "@erato/frontend/library.css";
import { componentRegistry } from "@erato/frontend/library";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import App from "./App";
import { AddinFileSourceSelector } from "./components/AddinFileSourceSelector";

function applyFrontendEnvToWindow() {
  window.API_ROOT_URL = import.meta.env.VITE_API_ROOT_URL;
  window.THEME_CUSTOMER_NAME = import.meta.env.VITE_THEME_CUSTOMER_NAME ?? null;
  window.THEME_PATH = import.meta.env.VITE_THEME_PATH ?? null;
  window.THEME_CONFIG_PATH = import.meta.env.VITE_THEME_CONFIG_PATH ?? null;
  window.THEME_LOGO_PATH = import.meta.env.VITE_LOGO_PATH ?? null;
  window.THEME_LOGO_DARK_PATH = import.meta.env.VITE_LOGO_DARK_PATH ?? null;
  window.THEME_ASSISTANT_AVATAR_PATH =
    import.meta.env.VITE_ASSISTANT_AVATAR_PATH ?? null;
  window.DISABLE_UPLOAD = import.meta.env.VITE_DISABLE_UPLOAD === "true";
  window.DISABLE_CHAT_INPUT_AUTOFOCUS =
    import.meta.env.VITE_DISABLE_CHAT_INPUT_AUTOFOCUS === "true";
  window.DISABLE_LOGOUT = import.meta.env.VITE_DISABLE_LOGOUT === "true";
  window.ASSISTANTS_ENABLED =
    import.meta.env.VITE_ASSISTANTS_ENABLED === "true";
  window.ASSISTANTS_SHOW_RECENT_ITEMS =
    import.meta.env.VITE_ASSISTANTS_SHOW_RECENT_ITEMS === "true";
  window.STARTER_PROMPTS_ENABLED =
    import.meta.env.VITE_STARTER_PROMPTS_ENABLED === "true";
  window.PROMPT_OPTIMIZER_ENABLED =
    import.meta.env.VITE_PROMPT_OPTIMIZER_ENABLED === "true";
  window.USER_PREFERENCES_ENABLED =
    import.meta.env.VITE_USER_PREFERENCES_ENABLED !== "false";
  window.SHAREPOINT_ENABLED =
    import.meta.env.VITE_SHAREPOINT_ENABLED === "true";
  window.MESSAGE_FEEDBACK_ENABLED =
    import.meta.env.VITE_MESSAGE_FEEDBACK_ENABLED === "true";
  window.MESSAGE_FEEDBACK_COMMENTS_ENABLED =
    import.meta.env.VITE_MESSAGE_FEEDBACK_COMMENTS_ENABLED === "true";

  if (import.meta.env.VITE_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS) {
    window.MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS = Number(
      import.meta.env.VITE_MESSAGE_FEEDBACK_EDIT_TIME_LIMIT_SECONDS,
    );
  }

  if (import.meta.env.VITE_MAX_UPLOAD_SIZE_BYTES) {
    window.MAX_UPLOAD_SIZE_BYTES = Number(
      import.meta.env.VITE_MAX_UPLOAD_SIZE_BYTES,
    );
  }

  window.SIDEBAR_COLLAPSED_MODE =
    import.meta.env.VITE_SIDEBAR_COLLAPSED_MODE ?? "hidden";
  window.SIDEBAR_LOGO_PATH = import.meta.env.VITE_SIDEBAR_LOGO_PATH ?? null;
  window.SIDEBAR_LOGO_DARK_PATH =
    import.meta.env.VITE_SIDEBAR_LOGO_DARK_PATH ?? null;
  window.SIDEBAR_CHAT_HISTORY_SHOW_METADATA =
    import.meta.env.VITE_SIDEBAR_CHAT_HISTORY_SHOW_METADATA !== "false";
  window.MSAL_CLIENT_ID = import.meta.env.VITE_MSAL_CLIENT_ID ?? null;
  window.MSAL_AUTHORITY = import.meta.env.VITE_MSAL_AUTHORITY ?? null;
}

applyFrontendEnvToWindow();
componentRegistry.ChatFileSourceSelector = AddinFileSourceSelector;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter basename="/office-addin">
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
