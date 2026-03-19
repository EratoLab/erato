import { I18nProvider as LinguiI18nProvider } from "@lingui/react";
import { useEffect } from "react";

import {
  ThemeProvider,
  type ThemeMode,
} from "@/components/providers/ThemeProvider";
import {
  defaultLocale,
  dynamicActivate,
  getValidLocale,
  i18n,
} from "@/lib/i18n";
import {
  StaticFeatureConfigProvider,
  type FeatureConfig,
} from "@/providers/FeatureConfigProvider";

import type { PropsWithChildren } from "react";

if (!i18n.locale) {
  i18n.loadAndActivate({
    locale: defaultLocale,
    messages: {},
  });
}

export interface EratoUiProviderProps extends PropsWithChildren {
  locale?: string;
  themeMode?: ThemeMode;
  featureConfig?: Partial<FeatureConfig>;
}

export function EratoUiProvider({
  children,
  locale = defaultLocale,
  themeMode = "light",
  featureConfig,
}: EratoUiProviderProps) {
  useEffect(() => {
    void dynamicActivate(getValidLocale(locale));
  }, [locale]);

  return (
    <LinguiI18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider config={featureConfig}>
        <ThemeProvider
          enableCustomTheme={false}
          initialThemeMode={themeMode}
          persistThemeMode={false}
        >
          {children}
        </ThemeProvider>
      </StaticFeatureConfigProvider>
    </LinguiI18nProvider>
  );
}
