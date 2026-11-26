"use client";

import { ApiProvider } from "./ApiProvider";
import { GenerationStatusPoller } from "./GenerationStatusPoller";
import { McpOauthCallbackBoundary } from "./McpOauthCallbackBoundary";
import { TabChatIndicator } from "./TabChatIndicator";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { StartPreload } from "../../app/startPreload";
import { useVirtualKeyboardViewport } from "../../hooks/ui/useVirtualKeyboardViewport";
import { ClientOperationPoller } from "../../providers/ClientOperationPoller";
import { DesktopSidecarClientTools } from "../../providers/DesktopSidecarClientTools";
import {
  DesktopSidecarConfigurationSync,
  DesktopSidecarProvider,
} from "../../providers/DesktopSidecarProvider";
import { FeatureConfigProvider } from "../../providers/FeatureConfigProvider";
import { I18nProvider } from "../../providers/I18nProvider";
import { StartScreen } from "../ui/Feedback/StartScreen";
import { McpAuthorizationToasts } from "../ui/Settings/mcpAuthorizationToasts";
import { Toaster } from "../ui/Toast/Toaster";

import type { PropsWithChildren } from "react";

/** The app appears once its theme is applied, never in another look first. */
function WhenThemeReady({ children }: PropsWithChildren) {
  const { isThemeReady } = useTheme();
  return isThemeReady ? children : <StartScreen />;
}

/**
 * Provider component that wraps the entire application
 * with all necessary providers in the correct order
 */
export function ClientProviders({ children }: PropsWithChildren) {
  useVirtualKeyboardViewport();

  return (
    <ApiProvider>
      <StartPreload />
      <GenerationStatusPoller />
      <TabChatIndicator />
      <DesktopSidecarProvider>
        <DesktopSidecarConfigurationSync />
        <ThemeProvider>
          <FeatureConfigProvider>
            <DesktopSidecarClientTools />
            <I18nProvider
              fallback={
                <div className="app-viewport flex">
                  <StartScreen />
                </div>
              }
            >
              <ClientOperationPoller />
              <>
                <div className="app-viewport flex" data-ui="app-shell">
                  <WhenThemeReady>
                    <McpOauthCallbackBoundary>
                      {children}
                    </McpOauthCallbackBoundary>
                  </WhenThemeReady>
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
