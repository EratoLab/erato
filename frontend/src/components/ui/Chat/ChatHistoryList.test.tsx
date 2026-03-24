import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistoryList, ChatHistoryListSkeleton } from "./ChatHistoryList";

import type { ChatSession } from "@/types/chat";
import type { Messages } from "@lingui/core";

vi.mock("@/components/ui", () => ({
  MessageTimestamp: ({ createdAt }: { createdAt: Date }) => (
    <span>{createdAt.toISOString()}</span>
  ),
}));

vi.mock("@/hooks/ui", () => ({
  useThemedIcon: () => null,
}));

vi.mock("../Controls/DropdownMenu", () => ({
  DropdownMenu: () => <div data-testid="row-menu" />,
}));

const sessions: ChatSession[] = [
  {
    id: "chat-1",
    title: "First chat",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
    metadata: {
      fileCount: 2,
    },
  },
  {
    id: "chat-2",
    title: "Second chat",
    messages: [],
    updatedAt: new Date("2024-01-02").toISOString(),
    metadata: {
      fileCount: 0,
    },
  },
];

describe("ChatHistoryList", () => {
  beforeEach(async () => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("uses the sidebar token surface for active history rows", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId="chat-1"
          onSessionSelect={vi.fn()}
          onSessionArchive={vi.fn()}
          onSessionEditTitle={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(
      container.querySelector('[data-ui="chat-history-list"]'),
    ).toBeTruthy();
    const historyItem = container.querySelector(
      '[data-ui="chat-history-item"]',
    );
    const historyItems = container.querySelectorAll(
      '[data-ui="chat-history-item"]',
    );

    expect(historyItem).toHaveStyle({
      minHeight: "var(--theme-spacing-sidebar-row-height)",
      borderRadius: "var(--theme-radius-shell)",
      backgroundColor: "var(--theme-shell-sidebar-selected)",
    });
    expect(historyItem).toHaveClass(
      "hover:bg-[var(--theme-shell-sidebar-hover)]",
    );
    expect(
      container.querySelector('[data-ui="chat-history-list"]'),
    ).toHaveStyle({
      padding:
        "calc(var(--theme-spacing-shell-padding-y) / 2) calc(var(--theme-spacing-shell-padding-x) / 2)",
    });
    expect(historyItems[1].getAttribute("style") ?? "").not.toContain(
      "background-color",
    );
  });

  it("uses the same sidebar tokens in the loading skeleton", () => {
    const { getAllByTestId } = render(<ChatHistoryListSkeleton />);

    const skeletonItem = getAllByTestId("chat-history-skeleton-item")[0];

    expect(skeletonItem).toHaveStyle({
      minHeight: "var(--theme-spacing-sidebar-row-height)",
      borderRadius: "var(--theme-radius-shell)",
      backgroundColor: "var(--theme-shell-sidebar-selected)",
    });
    expect(screen.getByTestId("chat-history-skeleton")).toHaveStyle({
      padding:
        "calc(var(--theme-spacing-shell-padding-y) / 2) calc(var(--theme-spacing-shell-padding-x) / 2)",
    });
  });

  it("keeps session rows as links while the inner layout wrapper stays presentational", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <ChatHistoryList
          sessions={sessions}
          currentSessionId="chat-1"
          onSessionSelect={vi.fn()}
          onSessionArchive={vi.fn()}
          onSessionEditTitle={vi.fn()}
        />
      </I18nProvider>,
    );

    const firstSessionLink = screen.getByRole("link", { name: "First chat" });
    const firstSessionItem = container.querySelector(
      '[data-chat-id="chat-1"]',
    ) as HTMLElement;

    expect(firstSessionLink).toHaveClass("focus-ring-tight");
    expect(firstSessionItem).not.toHaveAttribute("role");
    expect(firstSessionItem).not.toHaveAttribute("tabindex");
  });
});
