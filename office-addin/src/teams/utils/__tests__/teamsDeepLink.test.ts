import { describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import {
  buildTeamsMessageDeepLink,
  teamsMessageDeepLinkBase,
  teamsMessageDeepLinkSuffix,
} from "../teamsDeepLink";

describe("buildTeamsMessageDeepLink", () => {
  it("builds the byte-exact permalink for a thread chat id", () => {
    expect(buildTeamsMessageDeepLink(MOCK_CHAT_ID, "1741000000000")).toBe(
      "https://teams.microsoft.com/l/message/19%3Aabc123%40thread.v2/1741000000000" +
        "?context=%7B%22contextType%22%3A%22chat%22%7D",
    );
  });

  it("percent-encodes the colon and at-sign that every chat id contains", () => {
    const link = buildTeamsMessageDeepLink("19:x@thread.v2", "1");
    expect(link).toContain("19%3Ax%40thread.v2");
    expect(link).not.toContain("19:x@thread.v2");
  });

  it("encodes the message id too", () => {
    expect(buildTeamsMessageDeepLink("19:x@thread.v2", "a/b")).toContain(
      "/a%2Fb?",
    );
  });

  it("splits into a chat-invariant base plus the shared context suffix", () => {
    expect(
      `${teamsMessageDeepLinkBase(MOCK_CHAT_ID)}/9${teamsMessageDeepLinkSuffix()}`,
    ).toBe(buildTeamsMessageDeepLink(MOCK_CHAT_ID, "9"));
  });
});
