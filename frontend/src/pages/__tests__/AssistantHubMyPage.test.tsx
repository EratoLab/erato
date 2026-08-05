import { describe, expect, it } from "vitest";

import {
  getVisibleAssistantHubVersions,
  groupVersionsByAssistant,
} from "../AssistantHubMyPage";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const versions = [
  { version_id: "latest" },
  { version_id: "previous" },
  { version_id: "oldest" },
] as AssistantHubVersion[];

const groupedVersions = [
  {
    version_id: "older-assistant-version",
    hub_assistant_id: "older-assistant",
    submitted_at: "2026-08-04T12:00:00Z",
    assistant: { name: "Alpha" },
  },
  {
    version_id: "newer-assistant-version",
    hub_assistant_id: "newer-assistant",
    submitted_at: "2026-08-05T12:00:00Z",
    assistant: { name: "Zulu" },
  },
] as AssistantHubVersion[];

describe("getVisibleAssistantHubVersions", () => {
  it("shows only the latest version initially when more than two exist", () => {
    expect(
      getVisibleAssistantHubVersions(versions, false).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest"]);
  });

  it("shows all versions after expansion", () => {
    expect(
      getVisibleAssistantHubVersions(versions, true).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest", "previous", "oldest"]);
  });

  it("keeps groups with two or fewer versions fully visible", () => {
    expect(
      getVisibleAssistantHubVersions(versions.slice(0, 2), false).map(
        (version) => version.version_id,
      ),
    ).toEqual(["latest", "previous"]);
  });
});

describe("groupVersionsByAssistant", () => {
  it("orders assistants by their most recent submission", () => {
    expect(
      groupVersionsByAssistant(groupedVersions).map(
        (group) => group.hubAssistantId,
      ),
    ).toEqual(["newer-assistant", "older-assistant"]);
  });
});
