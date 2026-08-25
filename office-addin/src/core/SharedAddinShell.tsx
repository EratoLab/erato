import {
  ApiProvider,
  DesktopSidecarProvider,
  FeatureConfigProvider,
  GenerationStatusPoller,
  I18nProvider,
  ThemeProvider,
  Toaster,
  type SidecarClientInfo,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { useSessionAuth } from "./SessionAuthProvider";

import type { ComponentProps, ReactNode } from "react";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isInitialized, isAuthenticated, retryAuthentication, error } =
    useSessionAuth();

  if (!isInitialized) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status">
          {t({
            id: "officeAddin.auth.authenticating",
            message: "Authenticating...",
          })}
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status office-status--error" role="alert">
          {error ??
            t({
              id: "officeAddin.auth.signInToContinue",
              message: "Sign in to continue",
            })}
        </p>
        <button
          className="office-status-action"
          type="button"
          onClick={() => {
            void retryAuthentication();
          }}
        >
          {t({
            id: "officeAddin.auth.signIn",
            message: "Sign in",
          })}
        </button>
      </div>
    );
  }

  return (
    <>
      {children}
      {/* Inside the gate, never beside it: the poller is self-gated on the
          generation-status store and so stays idle between runs, but it seeds
          once on mount — and mounted above the auth provider that would be a
          request fired before `SessionAuthProvider` even exists, whose 401
          drives a forced token refresh and advances the refresh backoff.
          The seed exists because the pane reloads far more often than a tab
          and a background run launched before the last reload appears in no
          listing the pane reads. `isAuthenticated` stays true across
          transient refresh failures, so this does not remount and re-seed. */}
      <GenerationStatusPoller seedOnMount />
    </>
  );
}

type FeatureConfigOverrides = NonNullable<
  ComponentProps<typeof FeatureConfigProvider>["config"]
>;

/**
 * Baseline feature overrides for every add-in host composition. Nested
 * FeatureConfigProvider instances replace (not merge with) ancestor providers,
 * so host-specific providers must spread this constant.
 */
export const SHARED_ADDIN_FEATURE_CONFIG = {
  chatInput: { showUsageAdvisory: false },
} satisfies FeatureConfigOverrides;

/**
 * Host-neutral providers shared by every add-in composition. Host SDK and
 * authentication providers are deliberately supplied as children so loading
 * this module never initializes Office.js (or a future Teams SDK).
 */
export function SharedAddinShell({
  children,
  sidecarClientInfo,
}: {
  children: ReactNode;
  /**
   * Sidecar identity for this host composition. Without it the provider's
   * legacy platform sniff reports every add-in host as the Office add-in.
   */
  sidecarClientInfo?: SidecarClientInfo;
}) {
  return (
    <DesktopSidecarProvider clientInfo={sidecarClientInfo}>
      <I18nProvider>
        <ThemeProvider enableCustomTheme persistThemeMode={true}>
          <FeatureConfigProvider config={SHARED_ADDIN_FEATURE_CONFIG}>
            <ApiProvider enableDevtools={false}>
              {children}
              <Toaster placement="bottom-center" />
            </ApiProvider>
          </FeatureConfigProvider>
        </ThemeProvider>
      </I18nProvider>
    </DesktopSidecarProvider>
  );
}
