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

// Module scope, exactly as the Outlook and Teams compositions do it: the
// frontend classifies a Word fence as a host card only while the slot is
// registered, so registering inside an effect would render the first
// message's fences as plain code blocks.
installWordComponentRegistrations();

// Distinct from Outlook's "Microsoft Office add-in" and Teams' "Microsoft
// Teams tab": the sidecar identifies the surface, not the bundle.
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

/**
 * Word task-pane composition with document inclusion and reviewed write actions.
 * The literal word platform selects the backend's Word action facets.
 * Office.js nullifies history.pushState/replaceState, so avoid router navigation
 * after mounting this route.
 */
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
