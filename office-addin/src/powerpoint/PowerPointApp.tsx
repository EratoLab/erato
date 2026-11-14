import { createBrowserClientInfo } from "@erato/frontend/library";

import { PowerPointAddinChatHost } from "./PowerPointAddinChatHost";
import { PowerPointAddinSessionController } from "./powerpointSession";
import { NeutralAddinChatPage } from "../core/NeutralAddinChatPage";
import { AuthGate, SharedAddinShell } from "../core/SharedAddinShell";
import { OfficeDocumentAuthProvider } from "../providers/OfficeDocumentAuthProvider";
import { OfficeDocumentFeatureConfig } from "../providers/OfficeDocumentFeatureConfig";
import { OfficeProvider } from "../providers/OfficeProvider";
import { OfficeThemeProvider } from "../providers/OfficeThemeProvider";

const POWERPOINT_SIDECAR_CLIENT_INFO = createBrowserClientInfo({
  name: "erato-office-addin",
  version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
  hostApplication: "Microsoft PowerPoint add-in",
});

export default function PowerPointApp() {
  return (
    <SharedAddinShell sidecarClientInfo={POWERPOINT_SIDECAR_CLIENT_INFO}>
      <OfficeProvider>
        <OfficeDocumentFeatureConfig>
          <OfficeThemeProvider>
            <OfficeDocumentAuthProvider>
              <AuthGate>
                <div className="office-shell">
                  <NeutralAddinChatPage
                    platform="powerpoint"
                    SessionController={PowerPointAddinSessionController}
                    Host={PowerPointAddinChatHost}
                  />
                </div>
              </AuthGate>
            </OfficeDocumentAuthProvider>
          </OfficeThemeProvider>
        </OfficeDocumentFeatureConfig>
      </OfficeProvider>
    </SharedAddinShell>
  );
}
