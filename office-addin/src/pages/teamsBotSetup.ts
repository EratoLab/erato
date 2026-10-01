import release from "../../../site/public/setup/teams/1.0.0/release.json";
export { default as teamsHelperSource } from "../../../site/public/setup/teams/1.0.0/EratoTeamsSetup.ps1?raw";

export const teamsHelperRelease = {
  ...release,
  url: `https://erato.chat/setup/teams/${release.version}/EratoTeamsSetup.ps1`,
};

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

export function validGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Each command independently fetches and verifies the pinned public release. */
export function createTeamsSetupCommand(
  bot: TeamsBotSetup,
  origin: string,
  tenantId: string,
  subscriptionId: string,
  currentConnection: string,
  ssoConnection: string,
  mode: "check" | "preview" | "apply" = "check",
): string {
  if (!bot.authAppId || !validGuid(bot.authAppId) || !validGuid(bot.botId)) {
    throw new Error("Teams application IDs are missing or invalid");
  }
  if (!validGuid(tenantId) || !validGuid(subscriptionId)) {
    throw new Error("Enter valid tenant and subscription IDs");
  }
  if (
    !validConnectionName(currentConnection) ||
    !validConnectionName(ssoConnection) ||
    (mode !== "check" &&
      currentConnection.toLowerCase() === ssoConnection.toLowerCase())
  ) {
    throw new Error("Use valid, separate OAuth connection names");
  }
  const parameters = {
    TenantId: tenantId,
    SubscriptionId: subscriptionId,
    BaseUrl: origin,
    BotAppId: bot.botId,
    AuthAppId: bot.authAppId,
    SsoResource: proposedSsoResource(bot, origin),
    CurrentConnection: currentConnection,
    ConnectionName: ssoConnection,
  };
  const modeFlag =
    mode === "preview" ? " -WhatIf" : mode === "apply" ? " -Apply" : "";
  return `& {
  $ErrorActionPreference = 'Stop'
  $erato = @{
${Object.entries(parameters)
  .map(([key, value]) => `    ${key} = ${powershellQuote(value)}`)
  .join("\n")}
  }
  $helper = Join-Path $HOME 'EratoTeamsSetup-${release.version}.ps1'
  Invoke-WebRequest ${powershellQuote(teamsHelperRelease.url)} -OutFile $helper
  if ((Get-FileHash $helper -Algorithm SHA256).Hash -ne '${release.sha256}') {
    throw 'Script verification failed. Nothing was executed. Open the setup page again.'
  }
  & $helper @erato${modeFlag}
}`;
}
