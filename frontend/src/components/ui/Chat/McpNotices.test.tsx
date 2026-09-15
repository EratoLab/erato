import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { McpNotices } from "./McpNotices";

import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Messages } from "@lingui/core";

const assistantMessage = (
  overrides: Partial<UiChatMessage>,
): UiChatMessage => ({
  id: "msg_mcp_notices",
  content: [{ content_type: "text", text: "Answered without tools" }],
  role: "assistant",
  sender: "assistant",
  authorId: "assistant_1",
  createdAt: new Date("2025-01-01T12:00:00Z").toISOString(),
  status: "complete",
  ...overrides,
});

const renderNotices = async (message: UiChatMessage, showConnect?: boolean) => {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <McpNotices message={message} showConnect={showConnect} />
      </MemoryRouter>
    </I18nProvider>,
  );
};

describe("McpNotices", () => {
  // The exclusion the component owns: a switched-off server is probed before
  // it is withheld, so it can sit in both lists, and re-deriving this in a
  // renderer is exactly the drift the composed component prevents.
  it("reports a server in both lists once, as switched off", async () => {
    await renderNotices(
      assistantMessage({
        mcp_servers_disabled_by_user: ["linear"],
        mcp_servers_needing_auth: ["linear"],
      }),
    );

    expect(screen.getByTestId("mcp-disabled-servers-notice")).toHaveTextContent(
      "linear is switched off for this chat, so its tools were not used.",
    );
    expect(
      screen.queryByTestId("mcp-needs-auth-notice"),
    ).not.toBeInTheDocument();
  });

  it("offers Connect on a surface that has the settings chrome", async () => {
    await renderNotices(
      assistantMessage({ mcp_servers_needing_auth: ["github-server"] }),
    );

    expect(screen.getByTestId("mcp-needs-auth-connect")).toBeInTheDocument();
  });

  it("keeps the needs-auth text but drops Connect when it is suppressed", async () => {
    await renderNotices(
      assistantMessage({ mcp_servers_needing_auth: ["github-server"] }),
      false,
    );

    expect(screen.getByTestId("mcp-needs-auth-notice")).toHaveTextContent(
      "github-server is available in this chat but not connected, so its tools were not used.",
    );
    expect(
      screen.queryByTestId("mcp-needs-auth-connect"),
    ).not.toBeInTheDocument();
  });
});
