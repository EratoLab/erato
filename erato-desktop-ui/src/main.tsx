// Must stay the first import: it fills the window globals the library's
// `env()` reads, before any library module evaluates.
import "./app/env";
import "@erato/frontend/library.css";
import { ThemeProvider, type ThemeMode } from "@erato/frontend/library";
import { I18nProvider } from "@lingui/react";
import React from "react";
import ReactDOM from "react-dom/client";

import { activateLocale, i18n } from "./i18n";
import { SmokeWindow } from "./windows/smoke/SmokeWindow";

const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

const resolveThemeMode = (value: string | undefined): ThemeMode =>
  THEME_MODES.find((mode) => mode === value) ?? "system";

const config = window.ERATO_DESKTOP_UI ?? {};
const locale = activateLocale(config.locale);
const themeMode = resolveThemeMode(config.themeMode);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Could not find root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <I18nProvider i18n={i18n}>
      {/* Custom themes come from the network and component kits are customer
          code; neither runs inside the trusted window. Mode and text size are
          not persisted: the host decides them on every open. */}
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode={themeMode}
        persistThemeMode={false}
        persistTextSize={false}
      >
        <SmokeWindow locale={locale} hostVersion={config.version} />
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
