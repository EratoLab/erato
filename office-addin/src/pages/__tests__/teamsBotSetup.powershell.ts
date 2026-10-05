import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import {
  createTeamsSetupCommand,
  readTeamsBotSetup,
  teamsHelperRelease,
} from "../teamsBotSetup";

const runPowerShell = promisify(execFile);

// Run separately with test:teams-setup: a real PowerShell startup must not
// compete with the parallel DOM-heavy add-in suite on shared CI runners.
it("PowerShell passes deployment data literally and refuses tampered downloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "erato-teams-delivery-"));
  try {
    const botId = "11111111-1111-1111-1111-111111111111";
    const authAppId = "22222222-2222-2222-2222-222222222222";
    const tenant = "33333333-3333-3333-3333-333333333333";
    const subscription = "44444444-4444-4444-4444-444444444444";
    const maliciousResource = `api://customer's/$(throw 'injected')/botid-${botId}`;
    const bot = readTeamsBotSetup({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource: maliciousResource },
    })!;
    const input = createTeamsSetupCommand(
      bot,
      "https://erato.example.com",
      tenant,
      subscription,
      "graph",
      "graph-sso",
      "check",
      {
        messagingEndpoint:
          "https://bot.example.com/api/integrations/ms_teams/messages",
        resourceGroup: "rg-(customer)",
        botName: "erato.teams-bot",
      },
    );
    writeFileSync(
      join(directory, "fixture.ps1"),
      "param($TenantId,$SubscriptionId,$BaseUrl,$MessagingEndpoint,$BotAppId,$AuthAppId,$SsoResource,$CurrentConnection,$ConnectionName,$ResourceGroup,$BotName)\n$PSBoundParameters | ConvertTo-Json\n",
    );
    const harness = (hash: string) =>
      `function Join-Path { param($Path,$ChildPath); [IO.Path]::Combine((Get-Location).Path,$ChildPath) }\nfunction Invoke-WebRequest { param($Uri,$OutFile); Copy-Item './fixture.ps1' $OutFile }\nfunction Get-FileHash { param($Path,$Algorithm); @{Hash='${hash}'} }\n${input}`;
    const path = join(directory, "test.ps1");
    const args = ["-NoLogo", "-NoProfile", "-File", path];
    const options = {
      cwd: directory,
      encoding: "utf8" as const,
      timeout: 30_000,
    };
    writeFileSync(path, harness(teamsHelperRelease.sha256));
    const { stdout } = await runPowerShell("pwsh", args, options);
    expect(JSON.parse(stdout)).toMatchObject({
      TenantId: tenant,
      SubscriptionId: subscription,
      BotAppId: botId,
      AuthAppId: authAppId,
      SsoResource: maliciousResource,
      MessagingEndpoint:
        "https://bot.example.com/api/integrations/ms_teams/messages",
      ResourceGroup: "rg-(customer)",
      BotName: "erato.teams-bot",
    });
    writeFileSync(path, harness("incorrect"));
    await expect(runPowerShell("pwsh", args, options)).rejects.toThrow(
      "Script verification failed",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 75_000);
