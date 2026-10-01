import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTeamsSetupCommand,
  proposedSsoResource,
  readTeamsBotSetup,
  teamsHelperRelease,
} from "../teamsBotSetup";

const botId = "11111111-1111-1111-1111-111111111111";
const authAppId = "22222222-2222-2222-2222-222222222222";
const tenant = "33333333-3333-3333-3333-333333333333";
const subscription = "44444444-4444-4444-4444-444444444444";
const origin = "https://erato.example.com";
const resource = `api://erato.example.com/botid-${authAppId}`;
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
