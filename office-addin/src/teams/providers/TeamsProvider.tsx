import { t } from "@lingui/core/macro";
import { app } from "@microsoft/teams-js";
import { createContext, useContext, useEffect, useState } from "react";

import type { ReactNode } from "react";

/** Host themes TeamsJS reports; unknown values (e.g. `glass`) map to default. */
export type TeamsTheme = "default" | "dark" | "contrast";

interface TeamsContextValue {
  isReady: boolean;
  hostName: string | null;
  hostClientType: string | null;
  theme: TeamsTheme | null;
  /** MSAL login hint only; TeamsJS identity fields are never proof of identity. */
  userPrincipalName: string | null;
  /** Entra object id, matched against chat member ids to recognise the viewer. */
  userId: string | null;
}

const EMPTY_TEAMS_CONTEXT: TeamsContextValue = {
  isReady: false,
  hostName: null,
  hostClientType: null,
  theme: null,
  userPrincipalName: null,
  userId: null,
};

const TeamsContext = createContext<TeamsContextValue>(EMPTY_TEAMS_CONTEXT);

function normalizeTeamsTheme(theme: string | undefined): TeamsTheme {
  return theme === "dark" || theme === "contrast" ? theme : "default";
}

export function useTeams() {
  return useContext(TeamsContext);
}

/**
 * Children render only once `app.initialize()` has resolved, which is what
 * guarantees the NAA bridge exists before the auth provider builds MSAL.
 */
export function TeamsProvider({ children }: { children: ReactNode }) {
  const [context, setContext] =
    useState<TeamsContextValue>(EMPTY_TEAMS_CONTEXT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      await app.initialize();
      const teamsContext = await app.getContext();
      if (cancelled) {
        return;
      }

      setContext({
        isReady: true,
        hostName: teamsContext.app.host.name || null,
        hostClientType: teamsContext.app.host.clientType || null,
        theme: normalizeTeamsTheme(teamsContext.app.theme),
        userPrincipalName:
          teamsContext.user?.loginHint ??
          teamsContext.user?.userPrincipalName ??
          null,
        userId: teamsContext.user?.id ?? null,
      });

      // Single-slot registration with no unregister, so it is claimed once here
      // rather than per theme-consumer mount.
      app.registerOnThemeChangeHandler((theme) => {
        if (cancelled) {
          return;
        }
        setContext((current) => ({
          ...current,
          theme: normalizeTeamsTheme(theme),
        }));
      });

      // Releasing the host's loading indicator is reported separately from the
      // handshake: a rejection here must not tear down a tab that is already up.
      void app.notifySuccess().catch((cause: unknown) => {
        console.warn("Teams notifySuccess failed", cause);
      });
    };

    void bootstrap().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      try {
        app.notifyFailure({ reason: app.FailedReason.Other, message });
      } catch {
        // The host is unreachable, so the panel below is all we can surface.
      }
      if (!cancelled) {
        setError(message);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status office-status--error" role="alert">
          {t({
            id: "officeAddin.teams.initFailed",
            message: "Could not connect to Microsoft Teams.",
          })}
        </p>
      </div>
    );
  }

  if (!context.isReady) {
    return (
      <div className="office-shell office-shell--centered">
        <p className="office-status">
          {t({
            id: "officeAddin.teams.loading",
            message: "Loading Microsoft Teams tab...",
          })}
        </p>
      </div>
    );
  }

  return (
    <TeamsContext.Provider value={context}>{children}</TeamsContext.Provider>
  );
}
