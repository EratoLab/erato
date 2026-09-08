import { afterEach, describe, expect, it } from "vitest";

import { env } from "@/app/env";

describe("env chatInputEmptyStateLayout", () => {
  afterEach(() => {
    delete window.CHAT_INPUT_EMPTY_STATE_LAYOUT;
  });

  it("defaults to centered", () => {
    expect(env().chatInputEmptyStateLayout).toBe("centered");
  });

  it("keeps an explicit bottom override", () => {
    window.CHAT_INPUT_EMPTY_STATE_LAYOUT = "bottom";
    expect(env().chatInputEmptyStateLayout).toBe("bottom");
  });

  it("falls back to centered for unknown values", () => {
    window.CHAT_INPUT_EMPTY_STATE_LAYOUT = "sideways";
    expect(env().chatInputEmptyStateLayout).toBe("centered");
  });
});
