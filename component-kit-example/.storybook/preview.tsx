import {
  StaticFeatureConfigProvider,
  ThemeProvider,
} from "@erato/frontend/shared";
import { i18n } from "@lingui/core";
import { I18nProvider, Trans, useLingui } from "@lingui/react";
import type { Preview } from "@storybook/react";
import React, { createElement as h } from "react";
import { createPortal } from "react-dom";

// Host panels (the composer context lane) render host components, which
// need the host's stylesheet as they have in the app.
import "@erato/frontend/library.css";
import "./storybook.css";

import type { ReactNode } from "react";

type ComponentKitMode = "live" | "built";

const componentKitMode = import.meta.env.STORYBOOK_COMPONENT_KIT_MODE as
  | ComponentKitMode
  | undefined;

const liveCatalogs = import.meta.glob("../src/locales/*/messages.json");
const builtCatalogs = import.meta.glob("../dist/locales/*/messages.json");
// The host's own strings, for host components shown beside the kit's; empty
// until the frontend catalog is compiled.
const hostCatalogs = import.meta.glob(
  "../../frontend/src/locales/*/messages.json",
);

type CatalogModule = {
  messages?: Record<string, string>;
  default?: {
    messages?: Record<string, string>;
  };
};

declare global {
  interface Window {
    ERATO_REACT?: typeof React & { createPortal: typeof createPortal };
    ERATO_LINGUI_REACT?: {
      Trans: typeof Trans;
      useLingui: typeof useLingui;
    };
  }
}

window.ERATO_REACT = {
  ...React,
  createPortal,
};

window.ERATO_LINGUI_REACT = {
  Trans,
  useLingui,
};

const messagesFromCatalog = (catalogModule: CatalogModule) =>
  catalogModule.messages ?? catalogModule.default?.messages ?? {};

const loadHostMessages = async (locale: string) => {
  const loadHostCatalog =
    hostCatalogs[`../../frontend/src/locales/${locale}/messages.json`] ??
    hostCatalogs["../../frontend/src/locales/en/messages.json"];
  return loadHostCatalog
    ? messagesFromCatalog((await loadHostCatalog()) as CatalogModule)
    : {};
};

const activateLocale = async (
  locale: string,
  mode: ComponentKitMode = componentKitMode ?? "live",
) => {
  const catalogs = mode === "built" ? builtCatalogs : liveCatalogs;
  const catalogPath = `../${mode === "built" ? "dist" : "src"}/locales/${locale}/messages.json`;
  const loadCatalog =
    catalogs[catalogPath] ?? catalogs["../src/locales/en/messages.json"];
  const hostMessages = await loadHostMessages(locale);

  if (!loadCatalog) {
    i18n.loadAndActivate({ locale: "en", messages: hostMessages });
    return;
  }

  const catalogModule = (await loadCatalog()) as CatalogModule;
  i18n.loadAndActivate({
    locale,
    messages: { ...hostMessages, ...messagesFromCatalog(catalogModule) },
  });
};

if (!i18n.locale) {
  i18n.loadAndActivate({ locale: "en", messages: {} });
}

const withHostI18n = (Story: () => ReactNode) => {
  const [locale, setLocale] = React.useState(i18n.locale || "en");
  // Host components translate at render through the macro, not through the
  // provider, so the tree remounts once the catalogs are in.
  const [catalogsLoaded, setCatalogsLoaded] = React.useState(false);

  React.useEffect(() => {
    let isCurrent = true;

    void activateLocale("en").then(() => {
      if (isCurrent) {
        setLocale("en");
        setCatalogsLoaded(true);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <I18nProvider i18n={i18n} key={`${locale}:${String(catalogsLoaded)}`}>
      <StaticFeatureConfigProvider>
        <ThemeProvider
          enableCustomTheme={false}
          initialThemeMode="light"
          persistThemeMode={false}
        >
          <Story />
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </I18nProvider>
  );
};

const preview: Preview = {
  decorators: [withHostI18n],
  parameters: {
    layout: "fullscreen",
  },
};

export default preview;
