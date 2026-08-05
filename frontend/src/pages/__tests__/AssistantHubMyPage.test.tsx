import { describe, expect, it } from "vitest";

import { getVisibleAssistantHubVersions } from "../AssistantHubMyPage";

import type { AssistantHubVersion } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const versions = [
  { version_id: "latest" },
  { version_id: "previous" },
  { version_id: "oldest" },
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
