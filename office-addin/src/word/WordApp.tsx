import { createBrowserClientInfo } from "@erato/frontend/library";

import { WordAddinChatPage } from "./WordAddinChatPage";
import { useWordInPlaceDevProbe } from "./hooks/useWordInPlaceDevProbe";
import { installWordComponentRegistrations } from "./installWordComponentRegistrations";
import { AuthGate, SharedAddinShell } from "../core/SharedAddinShell";
import { OfficeDocumentAuthProvider } from "../providers/OfficeDocumentAuthProvider";
import { OfficeDocumentFeatureConfig } from "../providers/OfficeDocumentFeatureConfig";
import { OfficeProvider } from "../providers/OfficeProvider";
import { OfficeThemeProvider } from "../providers/OfficeThemeProvider";

// Register before the first React render; the component registry is a mutable global.
installWordComponentRegistrations();

const WORD_SIDECAR_CLIENT_INFO = createBrowserClientInfo({
  name: "erato-office-addin",
  version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
  hostApplication: "Microsoft Word add-in",
});

export default function WordApp() {
  useWordInPlaceDevProbe();
  return (
    <SharedAddinShell sidecarClientInfo={WORD_SIDECAR_CLIENT_INFO}>
      <OfficeProvider>
        <OfficeDocumentFeatureConfig>
          <OfficeThemeProvider>
            <OfficeDocumentAuthProvider>
              <AuthGate>
                <div className="office-shell">
                  <WordAddinChatPage />
                </div>
              </AuthGate>
            </OfficeDocumentAuthProvider>
          </OfficeThemeProvider>
        </OfficeDocumentFeatureConfig>
      </OfficeProvider>
    </SharedAddinShell>
  );
}
