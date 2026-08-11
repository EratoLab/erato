import { createBrowserClientInfo } from "@erato/frontend/library";

import { installTeamsComponentRegistrations } from "./installTeamsComponentRegistrations";
import { TeamsAuthProvider } from "./providers/TeamsAuthProvider";
import { TeamsChatPickerProvider } from "./providers/TeamsChatPickerProvider";
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

// Module scope, so the registry is populated before the first chat render.
installTeamsComponentRegistrations();

/**
 * Installs only the Teams "+" menu contribution: the Outlook renderers stay
 * route-local to `OutlookApp`, and this route loads no Office.js.
 */
export default function TeamsApp() {
  return (
    <SharedAddinShell sidecarClientInfo={TEAMS_SIDECAR_CLIENT_INFO}>
      <TeamsProvider>
        <TeamsThemeProvider>
          <TeamsAuthProvider>
            <AuthGate>
              <TeamsChatPickerProvider>
                <div className="office-shell">
                  <NeutralAddinChatPage
                    platform="teams"
                    SessionController={TeamsAddinSessionController}
                  />
                </div>
              </TeamsChatPickerProvider>
            </AuthGate>
          </TeamsAuthProvider>
        </TeamsThemeProvider>
      </TeamsProvider>
    </SharedAddinShell>
  );
}
