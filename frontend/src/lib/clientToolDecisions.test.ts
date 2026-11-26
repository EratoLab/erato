import { beforeEach, describe, expect, it, vi } from "vitest";

import { addUnsetClientToolDecisions } from "./clientToolDecisions";
import {
  fetchProfile,
  fetchUpdateProfilePreferences,
} from "./generated/v1betaApi/v1betaApiComponents";

vi.mock("./generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
  fetchUpdateProfilePreferences: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("adding decisions a pane carries over", () => {
  it("adds only tools without a stored decision, in one save", async () => {
    vi.mocked(fetchProfile).mockResolvedValue({
      client_tool_decisions: { "word/apply_document_plan": "ask" },
    } as never);
    const added = await addUnsetClientToolDecisions({
      "word/apply_document_plan": "always_allow",
      "word/apply_comment_changes": "never_allow",
    });
    expect(added).toEqual(["word/apply_comment_changes"]);
    expect(fetchUpdateProfilePreferences).toHaveBeenCalledTimes(1);
    expect(fetchUpdateProfilePreferences).toHaveBeenCalledWith({
      body: {
        client_tool_decisions: {
          "word/apply_document_plan": "ask",
          "word/apply_comment_changes": "never_allow",
        },
      },
    });
  });

  it("saves nothing when the server has a decision for every tool", async () => {
    vi.mocked(fetchProfile).mockResolvedValue({
      client_tool_decisions: { "word/apply_document_plan": "never_allow" },
    } as never);
    expect(
      await addUnsetClientToolDecisions({
        "word/apply_document_plan": "always_allow",
      }),
    ).toEqual([]);
    expect(fetchUpdateProfilePreferences).not.toHaveBeenCalled();
  });
});
