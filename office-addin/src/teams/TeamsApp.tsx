import { createBrowserClientInfo } from "@erato/frontend/library";

import { TeamsAuthProvider } from "./providers/TeamsAuthProvider";
import { TeamsProvider } from "./providers/TeamsProvider";
import { TeamsThemeProvider } from "./providers/TeamsThemeProvider";
import { TeamsAddinSessionController } from "./teamsSession";
import { NeutralAddinChatPage } from "../core/NeutralAddinChatPage";
import { AuthGate, SharedAddinShell } from "../core/SharedAddinShell";

const TEAMS_SIDECAR_CLIENT_INFO = createBrowserClientInfo({
  name: "erato-office-addin",
  version: import.meta.env.VITE_APP_VERSION ?? "unversioned",
  hostApplication: "Microsoft Teams tab",
});

/**
 * Installs no component-registry overrides: the Outlook contributions stay
 * route-local to `OutlookApp`, and this route loads no Office.js.
 */
export default function TeamsApp() {
  return (
    <SharedAddinShell sidecarClientInfo={TEAMS_SIDECAR_CLIENT_INFO}>
      <TeamsProvider>
        <TeamsThemeProvider>
          <TeamsAuthProvider>
            <AuthGate>
              <div className="office-shell">
                <NeutralAddinChatPage
                  platform="teams"
                  SessionController={TeamsAddinSessionController}
                />
              </div>
            </AuthGate>
          </TeamsAuthProvider>
        </TeamsThemeProvider>
      </TeamsProvider>
    </SharedAddinShell>
  );
}
