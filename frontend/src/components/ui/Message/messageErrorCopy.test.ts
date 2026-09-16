import { describe, expect, it } from "vitest";

import {
  getContentFilterCategoryLabel,
  getContentFilterSeverityLabel,
  getErrorCta,
  getErrorDescription,
  getErrorTitle,
} from "./messageErrorCopy";

// The openwebui kit hand-copies this wording to restyle the alert, so every
// branch the host grows is a branch the copy silently misses — a
// `hallucination_loop` abort already reads as the generic default there. These
// cases are what a kit calling the host's copy has to keep getting right.
const promptInjectionDetails = {
  pattern_id: "pi-42",
  matched_text: "ignore all previous instructions",
};

describe("getErrorDescription", () => {
  it("names the aborted generation for a hallucination loop", () => {
    expect(getErrorDescription("hallucination_loop")).toBe(
      "Generation aborted. Hallucination loop detected. Please regenerate the message.",
    );
  });

  it("names the guardrail when the filter details are a prompt injection", () => {
    expect(getErrorDescription("content_filter", promptInjectionDetails)).toBe(
      "The request was blocked because it matched a prompt injection guardrail.",
    );
  });

  it("names the content management policy for any other content filter", () => {
    expect(
      getErrorDescription("content_filter", {
        hate: { filtered: true, severity: "low" },
      }),
    ).toBe(
      "The response was filtered due to the prompt triggering content management policy.",
    );
  });

  it("names the quota for a rate limit", () => {
    expect(getErrorDescription("rate_limit")).toBe(
      "Rate limit or quota exceeded. This can also happen if your input is too large.",
    );
  });

  it("falls back to the generic wording for an unknown type", () => {
    expect(getErrorDescription("something_new")).toBe(
      "The assistant was unable to respond.",
    );
  });
});

describe("getErrorCta", () => {
  it("asks for an edit when the filter details are a prompt injection", () => {
    expect(getErrorCta("content_filter", promptInjectionDetails)).toBe(
      "Please edit the previous message to remove the offending text before continuing.",
    );
  });

  it("asks for a different message for any other content filter", () => {
    expect(getErrorCta("content_filter")).toBe(
      "Please try again with a different message that avoids the filtered categories.",
    );
  });

  it("asks for a retry and a smaller input for a rate limit", () => {
    expect(getErrorCta("rate_limit")).toBe(
      "Please try again in a minute, and reduce the length or number of attachments.",
    );
  });

  it("offers no call to action for a type without one", () => {
    expect(getErrorCta("hallucination_loop")).toBeUndefined();
    expect(getErrorCta("something_new")).toBeUndefined();
  });
});

describe("getErrorTitle", () => {
  it("leaves a content filter untitled", () => {
    expect(getErrorTitle("content_filter")).toBeUndefined();
  });

  it("titles every other error type", () => {
    expect(getErrorTitle("something_new")).toBe("Assistant error");
  });
});

describe("content filter labels", () => {
  it("translates the known categories and severities", () => {
    expect(getContentFilterCategoryLabel("self_harm")).toBe("Self harm");
    expect(getContentFilterSeverityLabel("medium")).toBe("medium severity");
  });

  it("title-cases an unknown category or severity", () => {
    // The provider is free to add a category, and an untranslated
    // `protected_material` reaching the bubble as a raw wire token is worse
    // than an untranslated but readable one.
    expect(getContentFilterCategoryLabel("protected_material")).toBe(
      "Protected Material",
    );
    expect(getContentFilterSeverityLabel("very_high")).toBe("Very High");
  });
});
