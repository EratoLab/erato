import { createBrowserClientInfo } from "@erato/frontend/library";

import { ExcelAddinSessionController } from "./excelSession";
import { NeutralAddinChatPage } from "../core/NeutralAddinChatPage";
import { AuthGate, SharedAddinShell } from "../core/SharedAddinShell";
import { OfficeDocumentAuthProvider } from "../providers/OfficeDocumentAuthProvider";
import { OfficeDocumentFeatureConfig } from "../providers/OfficeDocumentFeatureConfig";
import { OfficeProvider } from "../providers/OfficeProvider";
import { OfficeThemeProvider } from "../providers/OfficeThemeProvider";

const EXCEL_SIDECAR_CLIENT_INFO = createBrowserClientInfo({
  name: "erato-office-addin",
  version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
  hostApplication: "Microsoft Excel add-in",
});

export default function ExcelApp() {
  return (
    <SharedAddinShell sidecarClientInfo={EXCEL_SIDECAR_CLIENT_INFO}>
      <OfficeProvider>
        <OfficeDocumentFeatureConfig>
          <OfficeThemeProvider>
            <OfficeDocumentAuthProvider>
              <AuthGate>
                <div className="office-shell">
                  <NeutralAddinChatPage
                    platform="excel"
                    SessionController={ExcelAddinSessionController}
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
