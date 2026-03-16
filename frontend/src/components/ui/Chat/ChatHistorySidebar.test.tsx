import { I18nProvider } from "@lingui/react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ChatHistorySidebar } from "./ChatHistorySidebar";

import type { ChatSession } from "@/types/chat";
import type { Messages } from "@lingui/core";

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({
    effectiveTheme: "light",
    customThemeName: null,
  }),
}));

vi.mock("@/config/themeConfig", () => ({
  defaultThemeConfig: {
    getSidebarLogoPath: () => null,
  },
}));

vi.mock("@/hooks/ui", () => ({
  useResponsiveCollapsedMode: (mode: string) => mode,
  useThemedIcon: () => null,
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => ({
    enabled: false,
    showRecentItems: false,
  }),
  useSidebarFeature: () => ({
    collapsedMode: "hidden",
    logoPath: null,
    logoDarkPath: null,
  }),
}));

vi.mock("@/utils/themeUtils", () => ({
  checkFileExists: vi.fn(async () => false),
}));

vi.mock("./ChatHistoryList", () => ({
  ChatHistoryList: () => <div data-testid="history-list" />,
  ChatHistoryListSkeleton: () => <div data-testid="history-skeleton" />,
}));

vi.mock("./FrequentAssistantsList", () => ({
  FrequentAssistantsList: () => null,
}));

vi.mock("../Controls/UserProfileThemeDropdown", () => ({
  UserProfileThemeDropdown: () => <div data-testid="profile-dropdown" />,
}));

const sessions: ChatSession[] = [
  {
    id: "chat-1",
    title: "First chat",
    messages: [],
    updatedAt: new Date("2024-01-01").toISOString(),
  },
];

describe("ChatHistorySidebar", () => {
  beforeEach(async () => {
    const { i18n } = await import("@lingui/core");
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("uses the sidebar token surface for the shell", async () => {
    const { i18n } = await import("@lingui/core");
    const { container } = render(
      <MemoryRouter>
        <I18nProvider i18n={i18n}>
          <ChatHistorySidebar
            sessions={sessions}
            currentSessionId="chat-1"
            onSessionSelect={vi.fn()}
            onSessionArchive={vi.fn()}
            isLoading={false}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const sidebar = container.querySelector('[data-ui="sidebar"]');

    expect(sidebar).toHaveStyle({
      backgroundColor: "var(--theme-shell-sidebar)",
      borderRightColor: "var(--theme-border-divider)",
      boxShadow: "var(--theme-elevation-shell)",
      width: "var(--theme-layout-sidebar-width)",
    });
    expect(container.querySelector('[data-ui="sidebar-header"]')).toBeTruthy();
    expect(container.querySelector('[data-ui="sidebar-footer"]')).toBeTruthy();
  });
});
