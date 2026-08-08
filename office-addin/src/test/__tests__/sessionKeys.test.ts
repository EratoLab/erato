import { describe, expect, it } from "vitest";

import { NEUTRAL_CURRENT_CHAT_KEY } from "../../core/AddinChatProviderCore";
import { OUTLOOK_SESSION_KEY } from "../../sessionPolicy";

describe("add-in session storage separation", () => {
  it("uses different keys for neutral and Outlook chat selection", () => {
    expect(NEUTRAL_CURRENT_CHAT_KEY).not.toBe(OUTLOOK_SESSION_KEY);
  });
});
