import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLIENT_ACTION_PREFERENCES,
  clientActionPreferencesPersistedOptions,
  effectiveApprovalMode,
  isActionDenied,
  resolveAutoPromptBehavior,
  resolveClickBehavior,
  type ClientActionPreferences,
} from "../clientActionPolicy";

const prefs = (
  overrides: Partial<ClientActionPreferences> = {},
): ClientActionPreferences => ({
  ...DEFAULT_CLIENT_ACTION_PREFERENCES,
  ...overrides,
});

describe("effectiveApprovalMode", () => {
  it("defaults reproduce pre-settings behavior", () => {
    expect(effectiveApprovalMode("outlook.reply", prefs())).toBe("dont_ask");
    expect(effectiveApprovalMode("outlook.reply_all", prefs())).toBe(
      "always_ask",
    );
  });

  it("clamps reply_all to its always_ask floor — local settings cannot make it silent", () => {
    expect(
      effectiveApprovalMode(
        "outlook.reply_all",
        prefs({ "outlook.reply_all": "dont_ask" }),
      ),
    ).toBe("always_ask");
  });

  it("allows stricter settings everywhere", () => {
    expect(
      effectiveApprovalMode(
        "outlook.reply",
        prefs({ "outlook.reply": "deny" }),
      ),
    ).toBe("deny");
    expect(
      effectiveApprovalMode(
        "outlook.reply_all",
        prefs({ "outlook.reply_all": "deny" }),
      ),
    ).toBe("deny");
  });
});

describe("isActionDenied / resolveClickBehavior", () => {
  it("deny hides, always_ask confirms, dont_ask executes", () => {
    expect(
      isActionDenied("outlook.reply", prefs({ "outlook.reply": "deny" })),
    ).toBe(true);
    expect(resolveClickBehavior("outlook.reply", prefs())).toBe("execute");
    expect(
      resolveClickBehavior(
        "outlook.reply",
        prefs({ "outlook.reply": "always_ask" }),
      ),
    ).toBe("confirm");
    expect(resolveClickBehavior("outlook.reply_all", prefs())).toBe("confirm");
  });
});

describe("resolveAutoPromptBehavior", () => {
  const base = {
    presentation: "auto_prompt",
    proposedAction: "outlook.reply" as const,
    isFreshCompletion: true,
    preferences: prefs(),
  };

  it("executes for a fresh proposal under dont_ask", () => {
    expect(resolveAutoPromptBehavior(base)).toBe("execute");
  });

  it("confirms when the user prefers always_ask", () => {
    expect(
      resolveAutoPromptBehavior({
        ...base,
        preferences: prefs({ "outlook.reply": "always_ask" }),
      }),
    ).toBe("confirm");
  });

  it("confirms for reply_all even if storage claims dont_ask (floor)", () => {
    expect(
      resolveAutoPromptBehavior({
        ...base,
        proposedAction: "outlook.reply_all",
        preferences: prefs({ "outlook.reply_all": "dont_ask" }),
      }),
    ).toBe("confirm");
  });

  it("never fires without auto_prompt presentation", () => {
    expect(
      resolveAutoPromptBehavior({ ...base, presentation: "render_buttons" }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({ ...base, presentation: undefined }),
    ).toBe("none");
  });

  it("never fires for stale (history) completions", () => {
    expect(
      resolveAutoPromptBehavior({ ...base, isFreshCompletion: false }),
    ).toBe("none");
  });

  it("never fires without a validated proposal or when denied", () => {
    expect(
      resolveAutoPromptBehavior({ ...base, proposedAction: undefined }),
    ).toBe("none");
    expect(
      resolveAutoPromptBehavior({
        ...base,
        preferences: prefs({ "outlook.reply": "deny" }),
      }),
    ).toBe("none");
  });
});

describe("clientActionPreferencesPersistedOptions.parse", () => {
  const parse = clientActionPreferencesPersistedOptions.parse;

  it("accepts a valid stored shape", () => {
    expect(
      parse({ "outlook.reply": "deny", "outlook.reply_all": "always_ask" }),
    ).toEqual({ "outlook.reply": "deny", "outlook.reply_all": "always_ask" });
  });

  it("fills missing actions with defaults (forward compatible)", () => {
    expect(parse({ "outlook.reply": "always_ask" })).toEqual({
      "outlook.reply": "always_ask",
      "outlook.reply_all": "always_ask",
    });
  });

  it("rejects unknown modes and non-object values", () => {
    expect(parse({ "outlook.reply": "yolo" })).toBeNull();
    expect(parse("dont_ask")).toBeNull();
    expect(parse(null)).toBeNull();
  });
});
