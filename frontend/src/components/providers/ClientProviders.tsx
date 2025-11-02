"use client";

import { ApiProvider } from "./ApiProvider";
import { ThemeProvider } from "./ThemeProvider";
import { I18nProvider } from "../../providers/I18nProvider";
import { FeatureConfigProvider } from "../../providers/FeatureConfigProvider";

import type { PropsWithChildren } from "react";

/**
 * Provider component that wraps the entire application
 * with all necessary providers in the correct order
 */
export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ApiProvider>
      <ThemeProvider>
        <FeatureConfigProvider>
          <I18nProvider>
            <div className="flex h-screen min-h-screen bg-theme-bg-primary">
              {children}
            </div>
          </I18nProvider>
        </FeatureConfigProvider>
      </ThemeProvider>
    </ApiProvider>
  );
}
