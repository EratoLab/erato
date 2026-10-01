import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTeamsSetupScript,
  proposedSsoResource,
  readTeamsBotSetup,
} from "../teamsBotSetup";

const botId = "11111111-1111-1111-1111-111111111111";
const authAppId = "22222222-2222-2222-2222-222222222222";
const origin = "https://erato.example.com";
const resource = `api://erato.example.com/botid-${authAppId}`;

describe("Teams setup delivery", () => {
  it("keeps the combined SSO URI when bot and authentication IDs differ", () => {
    const bot = readTeamsBotSetup({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource },
    })!;
    expect(proposedSsoResource(bot, origin)).toBe(resource);
  });

  it("proposes a combined URI using the tab app, without claiming the tab URI enables bot SSO", () => {
    const bot = readTeamsBotSetup({
      bots: [{ botId }],
      webApplicationInfo: { id: authAppId, resource: `api://${authAppId}` },
    })!;
    expect(proposedSsoResource(bot, origin)).toBe(resource);
  });

  it("delivers one valid Bash script and treats manifest text as data", () => {
    const directory = mkdtempSync(join(tmpdir(), "erato-teams-delivery-"));
    try {
      const manifest = {
        bots: [{ botId }],
        description: {
          short: "Customer's $(exit 99) `exit 98`\nERATO_TEAMS_HELPER_PY",
        },
        webApplicationInfo: { id: authAppId, resource },
      };
      const bot = readTeamsBotSetup(manifest)!;
      const script = createTeamsSetupScript(
        bot,
        origin,
        "existing",
        "graph-sso",
      );
      const path = join(directory, "setup.sh");
      writeFileSync(path, script);
      execFileSync("bash", ["-n", path]);
      // Stand in for Python so this checks the actual shell parsing without cloud access.
      writeFileSync(
        join(directory, "python3"),
        '#!/bin/sh\nprintf "%s" "$ERATO_TEAMS_SETUP"\n',
        { mode: 0o700 },
      );
      writeFileSync(join(directory, "az"), "#!/bin/sh\nexit 99\n", {
        mode: 0o700,
      });
      const result = execFileSync("bash", [path], {
        encoding: "utf-8",
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      });
      expect(JSON.parse(result)).toEqual({
        baseUrl: origin,
        botId,
        authAppId,
        ssoResource: resource,
        currentConnection: "existing",
        ssoConnection: "graph-sso",
        manifest,
      });
      expect(script).toContain("def apply_sso(");
      expect(script).not.toContain("github.com/EratoLab/infrastructure");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a download without the authentication identity or with invalid connection names", () => {
    const bot = readTeamsBotSetup({ bots: [{ botId }] })!;
    expect(() =>
      createTeamsSetupScript(bot, origin, "graph", "graph-sso"),
    ).toThrow("app ID");
    expect(() =>
      createTeamsSetupScript({ ...bot, authAppId }, origin, "graph", "x; exit"),
    ).toThrow("connection name");
  });
});
