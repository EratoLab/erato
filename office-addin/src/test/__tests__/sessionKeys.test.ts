import { describe, expect, it } from "vitest";

import { NEUTRAL_CURRENT_CHAT_KEY } from "../../core/AddinChatProviderCore";
import { OUTLOOK_SESSION_KEY } from "../../outlook/sessionPolicy";
import { TEAMS_CURRENT_CHAT_KEY } from "../../teams/teamsSession";

describe("add-in session storage separation", () => {
  it("uses different keys for neutral and Outlook chat selection", () => {
    expect(NEUTRAL_CURRENT_CHAT_KEY).not.toBe(OUTLOOK_SESSION_KEY);
  });

  it("keeps the Teams selection out of the neutral and Outlook keys", () => {
    expect(TEAMS_CURRENT_CHAT_KEY).not.toBe(NEUTRAL_CURRENT_CHAT_KEY);
    expect(TEAMS_CURRENT_CHAT_KEY).not.toBe(OUTLOOK_SESSION_KEY);
  });
});
