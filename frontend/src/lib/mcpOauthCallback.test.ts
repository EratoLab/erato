import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMcpOauthCallback,
  getMcpOauthServerId,
  storeMcpOauthCallback,
} from "./mcpOauthCallback";

describe("MCP OAuth callback association", () => {
  beforeEach(() => sessionStorage.clear());

  it("recovers the server from state alone and clears only the handled flow", () => {
    storeMcpOauthCallback(
      "https://auth.example/authorize?state=first",
      "sales",
    );
    storeMcpOauthCallback(
      "https://auth.example/authorize?state=second",
      "search",
    );

    expect(getMcpOauthServerId("first")).toBe("sales");
    expect(getMcpOauthServerId("second")).toBe("search");
    expect(getMcpOauthServerId("unknown")).toBeNull();

    clearMcpOauthCallback("first");
    expect(getMcpOauthServerId("first")).toBeNull();
    expect(getMcpOauthServerId("second")).toBe("search");
  });

  it("rejects authorization URLs without state before navigating away", () => {
    expect(() =>
      storeMcpOauthCallback("https://auth.example/authorize", "sales"),
    ).toThrow("Missing MCP OAuth state");
  });
});
