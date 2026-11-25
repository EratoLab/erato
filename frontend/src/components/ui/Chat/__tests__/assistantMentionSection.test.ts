import { describe, expect, it, vi } from "vitest";

import { buildAssistantMentionSection } from "../assistantMentionSection";

const researcher = { id: "a-1", name: "Researcher" };
const editor = { id: "a-2", name: "Editor" };

describe("buildAssistantMentionSection", () => {
  it("names the most used assistant and counts the others when usage ranks them", () => {
    const section = buildAssistantMentionSection({
      suggested: [researcher, editor],
      suggestedFromUsage: true,
      onOpen: vi.fn(),
    });

    expect(section.items[0].description).toBe(
      "Researcher and 1 more you use often",
    );
  });

  it("does not claim the user uses them when the list is only in list order", () => {
    const section = buildAssistantMentionSection({
      suggested: [researcher, editor],
      suggestedFromUsage: false,
      onOpen: vi.fn(),
    });

    expect(section.items[0].description).toBe("Researcher and 1 more");
  });

  it("shows the one name alone, and nothing without assistants", () => {
    expect(
      buildAssistantMentionSection({ suggested: [researcher], onOpen: vi.fn() })
        .items[0].description,
    ).toBe("Researcher");
    expect(
      buildAssistantMentionSection({ suggested: [], onOpen: vi.fn() }).items[0]
        .description,
    ).toBeUndefined();
  });
});
