import {
  ApiProvider,
  FeatureConfigProvider,
  I18nProvider,
  ThemeProvider,
} from "@erato/frontend/library";

import { AddinChatPage } from "./pages/AddinChatPage";
import { MsalNaaProvider, useMsalNaa } from "./providers/MsalNaaProvider";
import { OfficeProvider, useOffice } from "./providers/OfficeProvider";
import { OutlookMailItemProvider } from "./providers/OutlookMailItemProvider";

import "./styles.css";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isInitialized, isAuthenticated, error } = useMsalNaa();

  if (!isInitialized) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status">Authenticating...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status office-status--error">
          {error ?? "Sign-in required"}
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

function OutlookWrapper({ children }: { children: React.ReactNode }) {
  const { host } = useOffice();

  if (host === "Outlook") {
    return <OutlookMailItemProvider>{children}</OutlookMailItemProvider>;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider
        enableCustomTheme={true}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        <FeatureConfigProvider
          config={{ chatInput: { showUsageAdvisory: false } }}
        >
          <ApiProvider enableDevtools={false}>
            <OfficeProvider>
              <MsalNaaProvider>
                <AuthGate>
                  <OutlookWrapper>
                    <div className="office-shell">
                      <AddinChatPage />
                    </div>
                  </OutlookWrapper>
                </AuthGate>
              </MsalNaaProvider>
            </OfficeProvider>
          </ApiProvider>
        </FeatureConfigProvider>
      </ThemeProvider>
    </I18nProvider>
  );
}
