"use client";

import { I18nProvider as LinguiI18nProvider } from "@lingui/react";
import { useEffect } from "react";

import {
  ThemeProvider,
  type TextSize,
  type ThemeMode,
} from "@/components/providers/ThemeProvider";
import {
  defaultLocale,
  dynamicActivate,
  getValidLocale,
  i18n,
} from "@/lib/i18n";
import {
  VoiceRuntimeProvider,
  type VoiceRuntimeAssetOverrides,
} from "@/lib/voice-runtime";
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
  textSize?: TextSize;
  featureConfig?: Partial<FeatureConfig>;
  voiceRuntimeAssets?: VoiceRuntimeAssetOverrides | string;
}

export function EratoUiProvider({
  children,
  locale = defaultLocale,
  themeMode = "light",
  textSize = "default",
  featureConfig,
  voiceRuntimeAssets,
}: EratoUiProviderProps) {
  useEffect(() => {
    void dynamicActivate(getValidLocale(locale));
  }, [locale]);

  return (
    <LinguiI18nProvider i18n={i18n}>
      <StaticFeatureConfigProvider config={featureConfig}>
        <VoiceRuntimeProvider voiceRuntimeAssets={voiceRuntimeAssets}>
          <ThemeProvider
            enableCustomTheme={false}
            initialThemeMode={themeMode}
            persistThemeMode={false}
            initialTextSize={textSize}
            persistTextSize={false}
          >
            {children}
          </ThemeProvider>
        </VoiceRuntimeProvider>
      </StaticFeatureConfigProvider>
    </LinguiI18nProvider>
  );
}
