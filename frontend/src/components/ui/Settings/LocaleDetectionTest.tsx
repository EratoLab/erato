import { Trans } from "@lingui/react/macro";
import React, { useState, useEffect } from "react";

import {
  detectLocale,
  supportedLocales,
  defaultLocale,
  dynamicActivate,
} from "@/lib/i18n";

/**
 * Simple test component to verify locale detection works correctly
 * This is for development/testing purposes only
 */
export function LocaleDetectionTest() {
  const [detectedLocale, setDetectedLocale] = useState<string>("");
  const [currentBrowserLang, setCurrentBrowserLang] = useState<string>("");

  useEffect(() => {
    // Get current detection results
    setDetectedLocale(detectLocale());
    setCurrentBrowserLang(navigator.language);
  }, []);

  const testLocaleChange = async (locale: string) => {
    try {
      await dynamicActivate(locale);
      setDetectedLocale(detectLocale());
    } catch (error) {
      console.error("Failed to activate locale:", error);
    }
  };

  const resetToDetected = () => {
    const freshDetection = detectLocale();
    void dynamicActivate(freshDetection);
    setDetectedLocale(freshDetection);
  };

  return (
    <div className="space-y-4 rounded-lg border border-[var(--theme-border)] p-4">
      <h3 className="text-lg font-semibold">
        <Trans>Locale Detection Test</Trans>
      </h3>

      <div className="grid gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <strong>
            <Trans>Detected Locale:</Trans>
          </strong>
          <span className="font-mono">{detectedLocale}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <strong>
            <Trans>Browser Language:</Trans>
          </strong>
          <span className="font-mono">{currentBrowserLang}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <strong>
            <Trans>Default Locale:</Trans>
          </strong>
          <span className="font-mono">{defaultLocale}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <strong>
            <Trans>Supported Locales:</Trans>
          </strong>
          <span className="font-mono">{supportedLocales.join(", ")}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium">
          <Trans>Test Locale Changes:</Trans>
        </h4>
        <div className="flex flex-wrap gap-2">
          {supportedLocales.map((locale) => (
            <button
              key={locale}
              onClick={() => {
                void testLocaleChange(locale);
              }}
              className="rounded bg-[var(--theme-bg-secondary)] px-3 py-1 text-sm hover:bg-[var(--theme-bg-tertiary)]"
            >
              {locale.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          onClick={resetToDetected}
          className="mt-2 rounded bg-blue-100 px-3 py-1 text-sm text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
        >
          <Trans>Reset to Browser Detection</Trans>
        </button>
      </div>

      <div className="rounded bg-[var(--theme-bg-secondary)] p-3 text-xs">
        <h5 className="mb-2 font-medium">
          <Trans>How to Test:</Trans>
        </h5>
        <ul className="space-y-1 text-[var(--theme-fg-muted)]">
          <li>
            <Trans>
              • Click locale buttons to test switching languages (session only)
            </Trans>
          </li>
          <li>
            <Trans>
              • Use &quot;Reset to Browser Detection&quot; to test fresh
              detection
            </Trans>
          </li>
          <li>
            <Trans>• Change browser language in settings and refresh</Trans>
          </li>
          <li>
            <Trans>
              • Check that UI updates immediately when locale changes
            </Trans>
          </li>
          <li>
            <Trans>
              • Note: Locale changes are not persisted across page refreshes
            </Trans>
          </li>
        </ul>
      </div>
    </div>
  );
}
