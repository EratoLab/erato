import { describe, expect, it } from "vitest";

import { actionFacetEstimate } from "../actionFacetEstimate";

const readText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

describe("actionFacetEstimate", () => {
  it("holds every arg the facet sends", async () => {
    const file = actionFacetEstimate({
      id: "word_selection",
      args: {
        selected_text: "The Supplier shall deliver.",
        truncated: "false",
      },
    });
    expect(file.name).toBe("word_selection.txt");
    expect(file.type).toBe("text/plain");
    const text = await readText(file);
    expect(text).toContain("selected_text: The Supplier shall deliver.");
    expect(text).toContain("truncated: false");
  });

  it("gives the same File for equal args, even in a new object", () => {
    const first = actionFacetEstimate({
      id: "outlook_review_draft",
      args: { full_body: "Hello" },
    });
    expect(
      actionFacetEstimate({
        id: "outlook_review_draft",
        args: { full_body: "Hello" },
      }),
    ).toBe(first);
  });

  it("gives a new File when an arg or the facet changes", () => {
    const args = { full_body: "Hello" };
    const first = actionFacetEstimate({ id: "outlook_review_draft", args });
    expect(
      actionFacetEstimate({
        id: "outlook_review_draft",
        args: { full_body: "Hello again" },
      }),
    ).not.toBe(first);
    expect(
      actionFacetEstimate({ id: "outlook_rewrite_selection", args }),
    ).not.toBe(first);
  });

  it("forgets the oldest of more than sixteen distinct facets", () => {
    const first = actionFacetEstimate({
      id: "word_selection",
      args: { selected_text: "evicted" },
    });
    for (let index = 0; index < 16; index += 1) {
      actionFacetEstimate({
        id: "word_selection",
        args: { selected_text: `filler ${index}` },
      });
    }
    expect(
      actionFacetEstimate({
        id: "word_selection",
        args: { selected_text: "evicted" },
      }),
    ).not.toBe(first);
  });
});
