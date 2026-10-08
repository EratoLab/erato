import release from "../../../site/public/setup/teams/1.1.0/release.json";
export { default as teamsHelperSource } from "../../../site/public/setup/teams/1.1.0/EratoTeamsSetup.ps1?raw";

export const teamsHelperRelease = {
  ...release,
  url: `https://erato.chat/setup/teams/${release.version}/EratoTeamsSetup.ps1`,
};

/** Path of the Teams bot messaging endpoint on an Erato deployment. */
export const TEAMS_BOT_MESSAGES_PATH = "/api/integrations/ms_teams/messages";

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

export type TeamsBotCredentialState =
  | "unknown"
  | "accepted"
  | "rejected"
  | "app_not_in_tenant";

/** `/office-addin/teams/bot-setup.json`: what this deployment uses for the bot. */
export type TeamsBotSetupInfo = {
  botAppId: string;
  authAppId: string | null;
  tenantId: string;
  connectionName: string;
  ssoResource: string | null;
  messagingEndpoint: string;
  /** False when the endpoint is just the address the setup page was opened at. */
  messagingEndpointConfigured: boolean;
  /** False when the deployment keeps a bot without single sign-on. */
  ssoEnabled: boolean;
  status: {
    activityReceived: boolean;
    credential: TeamsBotCredentialState;
  };
};

export function readTeamsBotSetupInfo(
  value: unknown,
): TeamsBotSetupInfo | null {
  if (!value || typeof value !== "object") return null;
  const info = value as Record<string, unknown> & {
    status?: Record<string, unknown>;
  };
  const text = (key: string) => {
    const field = info[key];
    return typeof field === "string" && field ? field : null;
  };
  const credential = info.status?.credential;
  const botAppId = text("botAppId");
  const tenantId = text("tenantId");
  const connectionName = text("connectionName");
  const messagingEndpoint = text("messagingEndpoint");
  if (
    !botAppId ||
    !tenantId ||
    !connectionName ||
    !messagingEndpoint ||
    !validMessagingEndpoint(messagingEndpoint)
  ) {
    return null;
  }
  return {
    botAppId,
    authAppId: text("authAppId"),
    tenantId,
    connectionName,
    ssoResource: text("ssoResource"),
    messagingEndpoint,
    messagingEndpointConfigured: info.messagingEndpointConfigured === true,
    ssoEnabled: info.ssoEnabled !== false,
    status: {
      activityReceived: info.status?.activityReceived === true,
      credential:
        credential === "accepted" ||
        credential === "rejected" ||
        credential === "app_not_in_tenant"
          ? credential
          : "unknown",
    },
  };
}

export function proposedSsoResource(
  bot: TeamsBotSetup,
  origin: string,
): string {
  // A tab's default api://<client-id> is not the combined bot/tab SSO URI.
  // Teams matches this suffix to the messaging bot, including when the
  // authentication app uses a separate registration.
  const resource = bot.manifestResource;
  const suffix = `botid-${bot.botId}`.toLowerCase();
  if (
    resource?.startsWith("api://") &&
    (resource.toLowerCase() === `api://${suffix}` ||
      resource.toLowerCase().endsWith(`/${suffix}`))
  ) {
    return resource;
  }
  return `api://${new URL(origin).host}/botid-${bot.botId}`;
}

export function validConnectionName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function validMessagingEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.pathname === TEAMS_BOT_MESSAGES_PATH &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Azure resource group names: letters, digits, `_-.()`, not ending in `.`. */
export function validResourceGroupName(value: string): boolean {
  return /^[\w.()-]{1,90}$/.test(value) && !value.endsWith(".");
}

/** Azure Bot resource names, as the Cloud Shell helper accepts them. */
export function validBotName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{1,62}$/.test(value);
}

export function validGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Where the bot lives and receives messages; all optional. */
export type TeamsSetupTarget = {
  /** Defaults to the setup page origin plus the messages path. */
  messagingEndpoint?: string;
  /** Together with `botName`, selects the bot, or names the one to create. */
  resourceGroup?: string;
  botName?: string;
};

/** Each command independently fetches and verifies the pinned public release. */
export function createTeamsSetupCommand(
  bot: TeamsBotSetup,
  origin: string,
  tenantId: string,
  subscriptionId: string,
  currentConnection: string,
  ssoConnection: string,
  mode: "check" | "preview" | "apply" = "check",
  target: TeamsSetupTarget = {},
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
  // A configured endpoint must be valid; the default follows BaseUrl, which
  // the helper itself requires to be HTTPS.
  if (
    target.messagingEndpoint !== undefined &&
    !validMessagingEndpoint(target.messagingEndpoint)
  ) {
    throw new Error("The messaging endpoint must be an HTTPS URL");
  }
  const messagingEndpoint =
    target.messagingEndpoint ??
    `${new URL(origin).origin}${TEAMS_BOT_MESSAGES_PATH}`;
  const resourceGroup = target.resourceGroup ?? "";
  const botName = target.botName ?? "";
  if (
    (resourceGroup || botName) &&
    !(validResourceGroupName(resourceGroup) && validBotName(botName))
  ) {
    throw new Error("Enter both a valid resource group and bot name");
  }
  const parameters: Record<string, string> = {
    TenantId: tenantId,
    SubscriptionId: subscriptionId,
    BaseUrl: origin,
    MessagingEndpoint: messagingEndpoint,
    BotAppId: bot.botId,
    AuthAppId: bot.authAppId,
    SsoResource: proposedSsoResource(bot, origin),
    CurrentConnection: currentConnection,
    ConnectionName: ssoConnection,
    ...(resourceGroup
      ? { ResourceGroup: resourceGroup, BotName: botName }
      : {}),
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
