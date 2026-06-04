import {
  ApiProvider,
  FeatureConfigProvider,
  I18nProvider,
  ThemeProvider,
  Toaster,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

import { AddinChatPage } from "./pages/AddinChatPage";
import { MsalNaaProvider, useMsalNaa } from "./providers/MsalNaaProvider";
import { OfficeProvider, useOffice } from "./providers/OfficeProvider";
import { OfficeThemeProvider } from "./providers/OfficeThemeProvider";
import { OutlookEmailSourceProvider } from "./providers/OutlookEmailSourceProvider";
import { OutlookMailItemProvider } from "./providers/OutlookMailItemProvider";

import "./styles.css";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isInitialized, isAuthenticated, retryAuthentication, error } =
    useMsalNaa();

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
              id: "officeAddin.auth.signInRequired",
              message: "Sign-in required",
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
            id: "officeAddin.auth.tryAgain",
            message: "Try again",
          })}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

function OutlookWrapper({ children }: { children: React.ReactNode }) {
  const { host } = useOffice();

  if (host === "Outlook") {
    return (
      <OutlookMailItemProvider>
        <OutlookEmailSourceProvider>{children}</OutlookEmailSourceProvider>
      </OutlookMailItemProvider>
    );
  }

  return <>{children}</>;
}

/**
 * Audio capture isn't available in every Outlook host — the Mac desktop client
 * (WebKit) and mobile are blocked. When the host can't capture, force the audio
 * feature flags off so the chat-input audio controls and the Microphone
 * settings tab — all gated on these flags — disappear together. This sits
 * inside {@link OfficeProvider} so it can read the platform probe, and still
 * wraps {@link ApiProvider} as the feature-config provider did before.
 */
function FeatureConfigGate({ children }: { children: React.ReactNode }) {
  const { supportsAudioCapture } = useOffice();

  return (
    <FeatureConfigProvider
      config={{
        chatInput: { showUsageAdvisory: false },
        ...(supportsAudioCapture
          ? {}
          : {
              audioTranscription: { enabled: false },
              audioDictation: { enabled: false },
              audioConversational: { enabled: false },
            }),
      }}
    >
      {children}
    </FeatureConfigProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider enableCustomTheme persistThemeMode={true}>
        <OfficeProvider>
          <FeatureConfigGate>
            <ApiProvider enableDevtools={false}>
              <OfficeThemeProvider>
                <MsalNaaProvider>
                  <AuthGate>
                    <OutlookWrapper>
                      <div className="office-shell">
                        <AddinChatPage />
                      </div>
                    </OutlookWrapper>
                  </AuthGate>
                  <Toaster placement="bottom-center" />
                </MsalNaaProvider>
              </OfficeThemeProvider>
            </ApiProvider>
          </FeatureConfigGate>
        </OfficeProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
