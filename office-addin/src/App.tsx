import {
  ApiProvider,
  FeatureConfigProvider,
  I18nProvider,
  ThemeProvider,
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
  const { isInitialized, isAuthenticated, error } = useMsalNaa();

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
        <p className="office-status office-status--error">
          {error ??
            t({
              id: "officeAddin.auth.signInRequired",
              message: "Sign-in required",
            })}
        </p>
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

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider enableCustomTheme persistThemeMode={true}>
        <FeatureConfigProvider
          config={{ chatInput: { showUsageAdvisory: false } }}
        >
          <ApiProvider enableDevtools={false}>
            <OfficeProvider>
              <OfficeThemeProvider>
                <MsalNaaProvider>
                  <AuthGate>
                    <OutlookWrapper>
                      <div className="office-shell">
                        <AddinChatPage />
                      </div>
                    </OutlookWrapper>
                  </AuthGate>
                </MsalNaaProvider>
              </OfficeThemeProvider>
            </OfficeProvider>
          </ApiProvider>
        </FeatureConfigProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
