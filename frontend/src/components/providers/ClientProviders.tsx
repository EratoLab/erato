"use client";

import { ApiProvider } from "./ApiProvider";
import { GenerationStatusPoller } from "./GenerationStatusPoller";
import { ThemeProvider } from "./ThemeProvider";
import {
  DesktopSidecarConfigurationSync,
  DesktopSidecarProvider,
} from "../../providers/DesktopSidecarProvider";
import { FeatureConfigProvider } from "../../providers/FeatureConfigProvider";
import { I18nProvider } from "../../providers/I18nProvider";
import { Toaster } from "../ui/Toast/Toaster";

import type { PropsWithChildren } from "react";

/**
 * Provider component that wraps the entire application
 * with all necessary providers in the correct order
 */
export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <ApiProvider>
      <GenerationStatusPoller />
      <DesktopSidecarProvider>
        <DesktopSidecarConfigurationSync />
        <ThemeProvider>
          <FeatureConfigProvider>
            <I18nProvider>
              <>
                <div
                  className="flex h-screen min-h-screen bg-theme-bg-primary"
                  data-ui="app-shell"
                >
                  {children}
                </div>
                <Toaster placement="bottom-center" />
              </>
            </I18nProvider>
          </FeatureConfigProvider>
        </ThemeProvider>
      </DesktopSidecarProvider>
    </ApiProvider>
  );
}
