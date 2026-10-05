import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTeamsSetupCommand,
  proposedSsoResource,
  readTeamsBotSetup,
  readTeamsBotSetupInfo,
  teamsHelperRelease,
  validBotName,
  validMessagingEndpoint,
  validResourceGroupName,
} from "../teamsBotSetup";

const botId = "11111111-1111-1111-1111-111111111111";
const authAppId = "22222222-2222-2222-2222-222222222222";
const tenant = "33333333-3333-3333-3333-333333333333";
const subscription = "44444444-4444-4444-4444-444444444444";
const origin = "https://erato.example.com";
const resource = `api://erato.example.com/botid-${botId}`;
const bot = readTeamsBotSetup({
  bots: [{ botId }],
  webApplicationInfo: { id: authAppId, resource },
})!;

function command(mode: "check" | "preview" | "apply" = "check") {
  return createTeamsSetupCommand(
    bot,
    origin,
    tenant,
    subscription,
    "graph",
    "graph-sso",
    mode,
  );
}

describe("Teams setup delivery", () => {
  it("keeps the combined SSO URI when messaging and authentication IDs differ", () => {
    expect(proposedSsoResource(bot, origin)).toBe(resource);
    const tab = readTeamsBotSetup({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource: `api://${authAppId}` },
    })!;
    expect(proposedSsoResource(tab, origin)).toBe(resource);
  });

  it("repairs a resource generated with the authentication app ID", () => {
    const wrong = {
      ...bot,
      manifestResource: `api://erato.example.com/botid-${authAppId}`,
    };
    expect(proposedSsoResource(wrong, origin)).toBe(resource);
    const generated = createTeamsSetupCommand(
      wrong,
      origin,
      tenant,
      subscription,
      "graph",
      "graph-sso",
    );
    expect(generated).toContain(`AuthAppId = '${authAppId}'`);
    expect(generated).toContain(`BotAppId = '${botId}'`);
    expect(generated).toContain(`SsoResource = '${resource}'`);
  });

  it("preserves a standalone or custom-domain resource for the correct bot", () => {
    for (const manifestResource of [
      `api://botid-${botId}`,
      `api://custom.example.com/botid-${botId}`,
    ]) {
      expect(proposedSsoResource({ ...bot, manifestResource }, origin)).toBe(
        manifestResource,
      );
    }
  });

  it("pins a published version and verifies the exact script bytes", () => {
    const source = readFileSync(
      resolve(
        `../site/public/setup/teams/${teamsHelperRelease.version}/EratoTeamsSetup.ps1`,
      ),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      teamsHelperRelease.sha256,
    );
    expect(teamsHelperRelease.url).toBe(
      `https://erato.chat/setup/teams/${teamsHelperRelease.version}/EratoTeamsSetup.ps1`,
    );
    for (const mode of ["check", "preview", "apply"] as const) {
      expect(command(mode)).toContain("Get-FileHash $helper -Algorithm SHA256");
      expect(command(mode)).toContain(teamsHelperRelease.sha256);
      expect(command(mode)).not.toContain("Invoke-Expression");
    }
    expect(command()).not.toMatch(/-Apply|-WhatIf/);
    expect(command("preview")).toContain("& $helper @erato -WhatIf");
    expect(command("apply")).toContain("& $helper @erato -Apply");
    expect(command("apply")).not.toContain("-Confirm:$false");
  });

  it("rejects incomplete target details and conflicting connection names", () => {
    expect(() =>
      createTeamsSetupCommand(
        { ...bot, authAppId: null },
        origin,
        tenant,
        subscription,
        "graph",
        "graph-sso",
      ),
    ).toThrow("application IDs");
    expect(() =>
      createTeamsSetupCommand(
        bot,
        origin,
        "",
        subscription,
        "graph",
        "graph-sso",
      ),
    ).toThrow("tenant and subscription");
    expect(() =>
      createTeamsSetupCommand(
        bot,
        origin,
        tenant,
        subscription,
        "graph",
        "GRAPH",
        "apply",
      ),
    ).toThrow("separate OAuth");
    expect(() =>
      createTeamsSetupCommand(
        bot,
        origin,
        tenant,
        subscription,
        "graph",
        "x; exit",
      ),
    ).toThrow("connection names");
  });
});

describe("Teams bot setup info", () => {
  const info = {
    botAppId: botId,
    authAppId,
    tenantId: tenant,
    connectionName: "graph-sso",
    ssoResource: resource,
    messagingEndpoint:
      "https://bot.example.com/api/integrations/ms_teams/messages",
    messagingEndpointConfigured: true,
    status: { activityReceived: true, credential: "accepted" },
  };

  it("reads the values the deployment uses", () => {
    expect(readTeamsBotSetupInfo(info)).toEqual(info);
    expect(
      readTeamsBotSetupInfo({ ...info, status: { credential: "other" } })
        ?.status,
    ).toEqual({ activityReceived: false, credential: "unknown" });
  });

  it("ignores missing or unsafe setup info", () => {
    expect(readTeamsBotSetupInfo("<OfficeApp />")).toBeNull();
    expect(readTeamsBotSetupInfo({ ...info, tenantId: "" })).toBeNull();
    expect(
      readTeamsBotSetupInfo({
        ...info,
        messagingEndpoint:
          "http://bot.example.com/api/integrations/ms_teams/messages",
      }),
    ).toBeNull();
  });

  it("validates endpoint, resource group and bot names", () => {
    expect(validMessagingEndpoint(info.messagingEndpoint)).toBe(true);
    for (const endpoint of [
      "https://bot.example.com/",
      "https://bot.example.com/api/integrations/ms_teams/messages?x=1",
      "https://user@bot.example.com/api/integrations/ms_teams/messages",
    ]) {
      expect(validMessagingEndpoint(endpoint)).toBe(false);
    }
    expect(validResourceGroupName("rg-erato_prod.(1)")).toBe(true);
    expect(validResourceGroupName("rg.")).toBe(false);
    expect(validResourceGroupName("rg'; exit")).toBe(false);
    expect(validBotName("erato-teams-bot")).toBe(true);
    expect(validBotName("-bot")).toBe(false);
    expect(validBotName("b")).toBe(false);
  });

  it("passes the messaging endpoint and an explicit bot to the helper", () => {
    const defaults = command();
    expect(defaults).toContain(
      "MessagingEndpoint = 'https://erato.example.com/api/integrations/ms_teams/messages'",
    );
    expect(defaults).not.toContain("ResourceGroup");
    const targeted = createTeamsSetupCommand(
      bot,
      origin,
      tenant,
      subscription,
      "graph",
      "graph-sso",
      "apply",
      {
        messagingEndpoint: info.messagingEndpoint,
        resourceGroup: "rg-erato",
        botName: "erato-teams-bot",
      },
    );
    expect(targeted).toContain(
      `MessagingEndpoint = '${info.messagingEndpoint}'`,
    );
    expect(targeted).toContain("ResourceGroup = 'rg-erato'");
    expect(targeted).toContain("BotName = 'erato-teams-bot'");
  });

  it("rejects an incomplete bot target or unsafe endpoint", () => {
    const attempt =
      (target: Parameters<typeof createTeamsSetupCommand>[7]) => () =>
        createTeamsSetupCommand(
          bot,
          origin,
          tenant,
          subscription,
          "graph",
          "graph-sso",
          "check",
          target,
        );
    expect(attempt({ resourceGroup: "rg-erato" })).toThrow("bot name");
    expect(attempt({ resourceGroup: "rg-erato", botName: "x'; exit" })).toThrow(
      "bot name",
    );
    expect(attempt({ messagingEndpoint: "https://bot.example.com/" })).toThrow(
      "messaging endpoint",
    );
  });
});
