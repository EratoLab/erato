import { i18n, type Messages } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import enMessages from "@/locales/en/messages.json";
import { resolveChatSendErrorMessage } from "@/utils/chatSendErrorMessage";

beforeAll(() => {
  // Activate the compiled English catalog so the macro-extracted message
  // resolves at runtime; without this the helper would fall back to the
  // raw template (still correct, but we want to assert against the
  // localized rendering path).
  i18n.load("en", enMessages.messages as unknown as Messages);
  i18n.activate("en");
});

describe("resolveChatSendErrorMessage", () => {
  it("returns null for non-Error values", () => {
    expect(resolveChatSendErrorMessage(null)).toBeNull();
    expect(resolveChatSendErrorMessage(undefined)).toBeNull();
    expect(resolveChatSendErrorMessage("just a string")).toBeNull();
    expect(resolveChatSendErrorMessage({ message: "fake" })).toBeNull();
  });

  it("formats action-facet size errors into a friendly localized string", () => {
    const error = new Error(
      "Argument 'full_body' for action facet 'outlook_review_draft' exceeds maximum size of 65536 bytes (got 80000 bytes)",
    );

    const result = resolveChatSendErrorMessage(error);

    expect(result).not.toBeNull();
    expect(result).toContain("78 KB"); // round(80000 / 1024) = 78
    expect(result).toContain("64 KB"); // round(65536 / 1024) = 64
    expect(result).toMatch(/draft is too long/i);
    expect(result).toMatch(/rewrite action/i);
  });

  it("falls back to the raw error.message for unrecognized errors", () => {
    const error = new Error("Network unreachable: ECONNRESET");
    expect(resolveChatSendErrorMessage(error)).toBe(
      "Network unreachable: ECONNRESET",
    );
  });

  it("returns null for an Error with an empty message", () => {
    expect(resolveChatSendErrorMessage(new Error(""))).toBeNull();
  });
});
