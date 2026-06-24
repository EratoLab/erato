import {
  StaticFeatureConfigProvider,
  ThemeProvider,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { I18nProvider, Trans, useLingui } from "@lingui/react";
import type { Preview } from "@storybook/react";
import React, { createElement as h } from "react";
import { createPortal } from "react-dom";

import "./storybook.css";

import type { ReactNode } from "react";

type ComponentKitMode = "live" | "built";

const componentKitMode = import.meta.env.STORYBOOK_COMPONENT_KIT_MODE as
  | ComponentKitMode
  | undefined;

const liveCatalogs = import.meta.glob("../src/locales/*/messages.json");
const builtCatalogs = import.meta.glob("../dist/locales/*/messages.json");

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

const activateLocale = async (
  locale: string,
  mode: ComponentKitMode = componentKitMode ?? "live",
) => {
  const catalogs = mode === "built" ? builtCatalogs : liveCatalogs;
  const catalogPath = `../${mode === "built" ? "dist" : "src"}/locales/${locale}/messages.json`;
  const loadCatalog =
    catalogs[catalogPath] ?? catalogs["../src/locales/en/messages.json"];

  if (!loadCatalog) {
    i18n.loadAndActivate({ locale: "en", messages: {} });
    return;
  }

  const catalogModule = (await loadCatalog()) as CatalogModule;
  i18n.loadAndActivate({
    locale,
    messages: messagesFromCatalog(catalogModule),
  });
};

if (!i18n.locale) {
  i18n.loadAndActivate({ locale: "en", messages: {} });
}

const withHostI18n = (Story: () => ReactNode) => {
  const [locale, setLocale] = React.useState(i18n.locale || "en");

  React.useEffect(() => {
    let isCurrent = true;

    void activateLocale("en").then(() => {
      if (isCurrent) {
        setLocale("en");
      }
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <I18nProvider i18n={i18n} key={locale}>
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
