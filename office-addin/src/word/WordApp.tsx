import {
  FeatureConfigProvider,
  createBrowserClientInfo,
} from "@erato/frontend/library";

import { WordAddinChatPage } from "./WordAddinChatPage";
import { installWordComponentRegistrations } from "./installWordComponentRegistrations";
import { WordAuthProvider } from "./providers/WordAuthProvider";
import {
  AuthGate,
  SHARED_ADDIN_FEATURE_CONFIG,
  SharedAddinShell,
} from "../core/SharedAddinShell";
import { OfficeProvider, useOffice } from "../providers/OfficeProvider";
import { OfficeThemeProvider } from "../providers/OfficeThemeProvider";

// Register before the first React render; the component registry is a mutable global.
installWordComponentRegistrations();

const WORD_SIDECAR_CLIENT_INFO = createBrowserClientInfo({
  name: "erato-office-addin",
  version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
  hostApplication: "Microsoft Word add-in",
});

function WordFeatureConfig({ children }: { children: React.ReactNode }) {
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

export default function WordApp() {
  return (
    <SharedAddinShell sidecarClientInfo={WORD_SIDECAR_CLIENT_INFO}>
      <OfficeProvider>
        <WordFeatureConfig>
          <OfficeThemeProvider>
            <WordAuthProvider>
              <AuthGate>
                <div className="office-shell">
                  <WordAddinChatPage />
                </div>
              </AuthGate>
            </WordAuthProvider>
          </OfficeThemeProvider>
        </WordFeatureConfig>
      </OfficeProvider>
    </SharedAddinShell>
  );
}
