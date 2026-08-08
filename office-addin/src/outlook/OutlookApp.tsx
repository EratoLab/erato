import { FeatureConfigProvider } from "@erato/frontend/library";

import { OutlookAddinChatPage } from "./OutlookAddinChatPage";
import { installOutlookComponentRegistrations } from "./installOutlookComponentRegistrations";
import {
  AuthGate,
  SHARED_ADDIN_FEATURE_CONFIG,
  SharedAddinShell,
} from "../core/SharedAddinShell";
import { OfficeProvider, useOffice } from "../providers/OfficeProvider";
import { OfficeThemeProvider } from "../providers/OfficeThemeProvider";
import { OutlookAuthProvider } from "./providers/OutlookAuthProvider";
import { OutlookEmailSourceProvider } from "./providers/OutlookEmailSourceProvider";
import { OutlookMailItemProvider } from "./providers/OutlookMailItemProvider";

import "../styles.css";

// The route module resolves before React renders its default export. Registry
// consumers can therefore memoize safely on their first render.
installOutlookComponentRegistrations();

function OutlookProviders({ children }: { children: React.ReactNode }) {
  const { host } = useOffice();
  if (host !== "Outlook") return <>{children}</>;
  return (
    <OutlookMailItemProvider>
      <OutlookEmailSourceProvider>{children}</OutlookEmailSourceProvider>
    </OutlookMailItemProvider>
  );
}

function OutlookFeatureConfig({ children }: { children: React.ReactNode }) {
  const { supportsAudioCapture } = useOffice();
  return (
    <FeatureConfigProvider
      config={{
        ...SHARED_ADDIN_FEATURE_CONFIG,
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

export default function OutlookApp() {
  return (
    <SharedAddinShell>
      <OfficeProvider>
        <OutlookFeatureConfig>
          <OfficeThemeProvider>
            <OutlookAuthProvider>
              <AuthGate>
                <OutlookProviders>
                  <div className="office-shell">
                    <OutlookAddinChatPage />
                  </div>
                </OutlookProviders>
              </AuthGate>
            </OutlookAuthProvider>
          </OfficeThemeProvider>
        </OutlookFeatureConfig>
      </OfficeProvider>
    </SharedAddinShell>
  );
}
