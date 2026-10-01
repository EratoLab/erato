import helperSource from "../../scripts/teams-bot/teams_bot_support.py?raw";

export type TeamsBotSetup = {
  botId: string;
  authAppId: string | null;
  manifestResource: string | null;
  manifest: Record<string, unknown>;
};

export function readTeamsBotSetup(manifest: unknown): TeamsBotSetup | null {
  if (!manifest || typeof manifest !== "object") return null;
  const document = manifest as Record<string, unknown> & {
    bots?: { botId?: unknown }[];
    webApplicationInfo?: { id?: unknown; resource?: unknown };
  };
  const botId = document.bots?.[0]?.botId;
  if (typeof botId !== "string" || !botId) return null;
  const { id, resource } = document.webApplicationInfo ?? {};
  return {
    botId,
    authAppId: typeof id === "string" ? id : null,
    manifestResource: typeof resource === "string" ? resource : null,
    manifest: document,
  };
}

export function proposedSsoResource(
  bot: TeamsBotSetup,
  origin: string,
): string {
  // A tab's default api://<client-id> is not the combined bot/tab SSO URI.
  // Keep an existing combined URI even when the OAuth and messaging IDs differ.
  if (bot.manifestResource?.includes("/botid-")) return bot.manifestResource;
  return `api://${new URL(origin).host}/botid-${bot.authAppId ?? bot.botId}`;
}

export function validConnectionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** One reviewable upload, with no repository access or requests to Erato from Cloud Shell. */
export function createTeamsSetupScript(
  bot: TeamsBotSetup,
  origin: string,
  currentConnection: string,
  ssoConnection: string,
): string {
  if (!bot.authAppId) throw new Error("Teams authentication app ID is missing");
  if (
    !validConnectionName(currentConnection) ||
    !validConnectionName(ssoConnection)
  ) {
    throw new Error("Invalid OAuth connection name");
  }
  const setup = JSON.stringify({
    baseUrl: origin,
    botId: bot.botId,
    authAppId: bot.authAppId,
    ssoResource: proposedSsoResource(bot, origin),
    currentConnection,
    ssoConnection,
    manifest: bot.manifest,
  });
  // JSON newlines are escaped; shell quoting also protects apostrophes and substitutions.
  return `#!/usr/bin/env bash
# Erato Teams setup. Run in Azure Cloud Shell (Bash).
# Default: read-only audit. --plan-sso: preview. --apply-sso: explicit Azure/Entra writes.
# Deployment and manifest are a snapshot from the setup page; download again after changes.
set -eu
for tool in az python3; do
  command -v "$tool" >/dev/null || { echo "Open Azure Cloud Shell (Bash): $tool is required." >&2; exit 2; }
done
export ERATO_TEAMS_SETUP=${shellQuote(setup)}
exec python3 - "$@" <<'ERATO_TEAMS_HELPER_PY'
${helperSource}
ERATO_TEAMS_HELPER_PY
`;
}
