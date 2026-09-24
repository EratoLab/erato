"use client";

import { ApiProvider } from "./ApiProvider";
import { GenerationStatusPoller } from "./GenerationStatusPoller";
import { McpOauthCallbackBoundary } from "./McpOauthCallbackBoundary";
import { TabChatIndicator } from "./TabChatIndicator";
import { ThemeProvider } from "./ThemeProvider";
import { DesktopSidecarClientTools } from "../../providers/DesktopSidecarClientTools";
import {
  DesktopSidecarConfigurationSync,
  DesktopSidecarProvider,
} from "../../providers/DesktopSidecarProvider";
import { FeatureConfigProvider } from "../../providers/FeatureConfigProvider";
import { I18nProvider } from "../../providers/I18nProvider";
import { LocalTaskCoordinator } from "../../providers/LocalTaskCoordinator";
import { McpAuthorizationToasts } from "../ui/Settings/mcpAuthorizationToasts";
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
      <TabChatIndicator />
      <DesktopSidecarProvider>
        <DesktopSidecarConfigurationSync />
        <ThemeProvider>
          <FeatureConfigProvider>
            <DesktopSidecarClientTools />
            <I18nProvider>
              <LocalTaskCoordinator />
              <>
                <div
                  className="flex h-screen min-h-screen bg-theme-bg-primary"
                  data-ui="app-shell"
                >
                  <McpOauthCallbackBoundary>
                    {children}
                  </McpOauthCallbackBoundary>
                </div>
                <Toaster placement="bottom-center" />
                {/* An authorization outlives the settings dialog it starts
                    in, so its outcome is announced from the app, not the
                    pane. */}
                <McpAuthorizationToasts />
              </>
            </I18nProvider>
          </FeatureConfigProvider>
        </ThemeProvider>
      </DesktopSidecarProvider>
    </ApiProvider>
  );
}
