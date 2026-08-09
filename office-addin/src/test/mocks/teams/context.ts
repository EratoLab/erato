/**
 * TeamsJS is a module import, not a global, so consumers replace it with
 * `vi.mock("@microsoft/teams-js", …)` rather than stubbing it in setup.
 */

/** The subset of `app.Context` the Teams composition reads. */
export interface MockTeamsContext {
  app: {
    locale: string;
    theme: string;
    sessionId: string;
    host: { name: string; clientType: string; sessionId: string };
  };
  page: { id: string; frameContext: string };
  user?: {
    id: string;
    loginHint?: string;
    userPrincipalName?: string;
  };
  dialogParameters: Record<string, string>;
}

export const MOCK_TEAMS_LOGIN_HINT = "erato.user@contoso.test";

export function createMockTeamsContext(
  overrides: Partial<MockTeamsContext> = {},
): MockTeamsContext {
  return {
    app: {
      locale: "en-us",
      theme: "default",
      sessionId: "app-session",
      host: { name: "Teams", clientType: "web", sessionId: "host-session" },
    },
    page: { id: "eratoChat", frameContext: "content" },
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      loginHint: MOCK_TEAMS_LOGIN_HINT,
      userPrincipalName: MOCK_TEAMS_LOGIN_HINT,
    },
    dialogParameters: {},
    ...overrides,
  };
}

/** Stands in for the bridge TeamsJS installs while `app.initialize()` resolves. */
export function installMockNestedAppAuthBridge() {
  (window as unknown as { nestedAppAuthBridge?: unknown }).nestedAppAuthBridge =
    {};
}

export function uninstallMockNestedAppAuthBridge() {
  Reflect.deleteProperty(window, "nestedAppAuthBridge");
}
