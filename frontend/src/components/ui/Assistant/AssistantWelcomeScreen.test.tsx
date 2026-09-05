import { i18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { messages as enMessages } from "@/locales/en/messages.json";
import { FileTypeUtil } from "@/utils/fileTypes";

import {
  AssistantWelcomeLower,
  AssistantWelcomeScreen,
  AssistantWelcomeUpper,
} from "./AssistantWelcomeScreen";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

i18n.load("en", enMessages as unknown as Messages);
i18n.activate("en");

vi.mock("@/hooks/ui/usePageAlignment", () => ({
  usePageAlignment: () => ({
    containerClasses: "max-w-4xl mx-auto",
    textAlignment: "text-left",
    flexAlignment: "items-start",
    justifyAlignment: "justify-start",
  }),
}));

vi.mock("@/components/ui/Chat/StarterPromptsSection", () => ({
  StarterPromptsSection: () => (
    <div data-testid="starter-prompts-section">starter prompts</div>
  ),
}));

describe("AssistantWelcomeScreen", () => {
  it("does not render starter prompts on the assistant welcome screen", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: false,
    };

    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <MemoryRouter>
            <AssistantWelcomeScreen assistant={assistant} />
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    );

    expect(
      screen.queryByTestId("starter-prompts-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Start typing below to begin a new conversation"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("assistant-welcome-screen-default").className,
    ).toContain("w-full");
    expect(
      screen.getByTestId("assistant-welcome-avatar-initial"),
    ).toHaveTextContent("B");
    expect(screen.queryByText("System Prompt")).not.toBeInTheDocument();
  });

  it("opens assistant configuration from the large name and renders edit as a secondary button", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: true,
    };

    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <MemoryRouter>
            <AssistantWelcomeScreen assistant={assistant} />
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Budget Assistant" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Assistant Settings" }),
    ).toHaveClass(
      "bg-theme-bg-secondary",
      "border",
      "border-theme-border",
      "text-theme-fg-secondary",
    );
  });

  it("opens assistant configuration from the large assistant icon", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: false,
    };

    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <MemoryRouter>
            <AssistantWelcomeScreen assistant={assistant} />
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId("assistant-welcome-avatar-button"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
  });

  it("warns when assistant files are inaccessible and includes creator email", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      owner_email: "owner@example.com",
      can_edit: false,
      files: [
        {
          id: "file-1",
          filename: "restricted.pdf",
          download_url: null,
          preview_url: null,
          file_contents_unavailable_missing_permissions: true,
          file_capability:
            FileTypeUtil.createMockFileCapability("restricted.pdf"),
          is_sharepoint_file: false,
        },
      ],
    };

    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <MemoryRouter>
            <AssistantWelcomeScreen assistant={assistant} />
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId("assistant-welcome-avatar-button"));

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(
      "Some default files are inaccessible due to missing permissions.",
    );
    expect(
      screen.getByRole("link", { name: "owner@example.com" }),
    ).toHaveAttribute("href", "mailto:owner@example.com");
  });

  describe("split parts", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: false,
    };
    const pastChats: ChatSession[] = [
      {
        id: "chat-1",
        title: "chat-1",
        updatedAt: "2026-03-23T09:00:00.000Z",
        messages: [],
      },
    ];

    it("keeps identity above and the conversations block below", () => {
      render(
        <ThemeProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter>
              <AssistantWelcomeScreen
                assistant={assistant}
                pastChats={pastChats}
              />
            </MemoryRouter>
          </I18nProvider>
        </ThemeProvider>,
      );

      const upper = screen.getByTestId("assistant-welcome-screen-default");
      const lower = screen.getByTestId("assistant-welcome-screen-lower");
      expect(upper).toContainElement(
        screen.getByTestId("assistant-welcome-avatar-button"),
      );
      expect(upper).toContainElement(
        screen.getByText("Helps with finance questions"),
      );
      expect(lower).toContainElement(
        screen.getByRole("heading", {
          level: 2,
          name: "Your conversations with this assistant",
        }),
      );
      expect(lower).toContainElement(screen.getByText("chat-1"));
      expect(lower).toHaveClass(
        "max-w-[var(--theme-layout-chat-input-max-width)]",
        "mt-4",
        "sm:mt-6",
      );
      expect(
        upper.compareDocumentPosition(lower) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("opens the configuration from the upper part on its own", () => {
      render(
        <ThemeProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter>
              <AssistantWelcomeUpper assistant={assistant} />
            </MemoryRouter>
          </I18nProvider>
        </ThemeProvider>,
      );

      expect(screen.queryByTestId("assistant-welcome-screen-lower")).toBeNull();
      fireEvent.click(screen.getByTestId("assistant-welcome-avatar-button"));

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("System Prompt")).toBeInTheDocument();
    });

    it("renders the loading spinner in the lower part", () => {
      const { container } = render(
        <ThemeProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter>
              <AssistantWelcomeLower assistant={assistant} isLoadingChats />
            </MemoryRouter>
          </I18nProvider>
        </ThemeProvider>,
      );

      expect(
        screen.queryByTestId("assistant-welcome-screen-default"),
      ).toBeNull();
      expect(
        screen.queryByText("Your conversations with this assistant"),
      ).toBeNull();
      expect(container.querySelector(".animate-spin")).not.toBeNull();
    });
  });

  it("keeps the conversations heading on the theme's page alignment", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: false,
    };

    render(
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <MemoryRouter>
            <AssistantWelcomeScreen
              assistant={assistant}
              pastChats={[
                {
                  id: "chat-1",
                  title: "chat-1",
                  updatedAt: "2026-03-23T09:00:00.000Z",
                  messages: [],
                },
              ]}
            />
          </MemoryRouter>
        </I18nProvider>
      </ThemeProvider>,
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Your conversations with this assistant",
    });
    expect(heading).toHaveClass("text-left");
    expect(heading.parentElement).toHaveClass("justify-start");
  });

  describe("delegated runs segment", () => {
    const assistant: AssistantWithFiles = {
      id: "assistant-1",
      name: "Budget Assistant",
      description: "Helps with finance questions",
      prompt: "Use the supplied policy docs to answer questions.",
      created_at: "2026-03-23T08:00:00.000Z",
      facet_ids: [],
      enforce_facet_settings: false,
      mcp_server_ids: [],
      updated_at: "2026-03-23T09:00:00.000Z",
      files: [],
      can_edit: false,
    };

    const session = (overrides: Partial<ChatSession> & { id: string }) => ({
      title: overrides.id,
      updatedAt: "2026-03-23T09:00:00.000Z",
      messages: [],
      ...overrides,
    });

    const renderScreen = (
      props: Partial<React.ComponentProps<typeof AssistantWelcomeScreen>>,
    ) =>
      render(
        <ThemeProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter>
              <AssistantWelcomeScreen assistant={assistant} {...props} />
            </MemoryRouter>
          </I18nProvider>
        </ThemeProvider>,
      );

    beforeEach(() => {
      useGenerationStatusStore.getState().reset();
    });

    it("explains an empty chats segment instead of showing a bare tab strip", () => {
      renderScreen({ delegatedRuns: [session({ id: "run-1" })] });

      expect(screen.getByRole("tablist")).toBeInTheDocument();
      expect(
        screen.getByText("No direct conversations yet."),
      ).toBeInTheDocument();
    });

    it("keeps the chosen segment when the screen is unmounted and comes back", () => {
      // Opening a conversation swaps the welcome screen out of the tree while
      // the router stays mounted.
      const tree = (conversationOpen: boolean) => (
        <ThemeProvider>
          <I18nProvider i18n={i18n}>
            <MemoryRouter>
              {conversationOpen ? (
                <div />
              ) : (
                <AssistantWelcomeScreen
                  assistant={assistant}
                  pastChats={[session({ id: "chat-1" })]}
                  delegatedRuns={[session({ id: "run-1" })]}
                />
              )}
            </MemoryRouter>
          </I18nProvider>
        </ThemeProvider>
      );
      const { rerender } = render(tree(false));

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));
      expect(screen.getByText("run-1")).toBeInTheDocument();

      rerender(tree(true));
      rerender(tree(false));

      expect(
        screen.getByRole("tab", { name: "Delegated runs" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("run-1")).toBeInTheDocument();
    });

    it("hides the segmented control when nothing was delegated and delegation is off", () => {
      renderScreen({ pastChats: [session({ id: "chat-1" })] });

      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.getByText("chat-1")).toBeInTheDocument();
    });

    it("offers the segment while delegation is on but nothing has been delegated", () => {
      renderScreen({
        pastChats: [session({ id: "chat-1" })],
        delegationEnabled: true,
      });

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));

      expect(screen.getByText("No delegated runs yet.")).toBeInTheDocument();
      expect(screen.queryByText("chat-1")).not.toBeInTheDocument();
    });

    it("offers the segment for existing delegated runs even with delegation off", () => {
      renderScreen({
        pastChats: [session({ id: "chat-1" })],
        delegatedRuns: [session({ id: "run-1" })],
      });

      expect(screen.queryByText("run-1")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));

      expect(screen.getByText("run-1")).toBeInTheDocument();
      expect(screen.queryByText("chat-1")).not.toBeInTheDocument();
    });

    it("names the origin chat a delegated run was spawned from", () => {
      renderScreen({
        delegatedRuns: [
          session({
            id: "run-1",
            title: "Summarise the vendor contract",
            provenanceKind: "delegation",
            originChatId: "origin-1",
            originChatTitle: "Quarterly planning",
          }),
        ],
      });

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));

      expect(screen.getByText("From Quarterly planning")).toBeInTheDocument();
    });

    it("does not repeat the backend's untitled sentinel in the origin hint", () => {
      renderScreen({
        delegatedRuns: [
          session({
            id: "run-1",
            title: "Summarise the vendor contract",
            provenanceKind: "delegation",
            originChatId: "origin-1",
            originChatTitle: "Untitled Chat",
          }),
        ],
      });

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));

      expect(
        screen.getByText("From an untitled conversation"),
      ).toBeInTheDocument();
      expect(screen.queryByText("From Untitled Chat")).not.toBeInTheDocument();
    });

    it("localizes the row title of a chat the backend left untitled", () => {
      renderScreen({
        pastChats: [
          session({
            id: "chat-1",
            title: "Untitled Chat",
            titleResolved: "Untitled Chat",
          }),
        ],
      });

      expect(screen.getByText("New Chat")).toBeInTheDocument();
      expect(screen.queryByText("Untitled Chat")).not.toBeInTheDocument();
    });

    it("keeps the origin hint off chats that were not delegated", () => {
      renderScreen({
        pastChats: [
          session({
            id: "chat-1",
            provenanceKind: "handoff_branch",
            originChatId: "origin-1",
            originChatTitle: "Quarterly planning",
          }),
        ],
      });

      expect(
        screen.queryByText("From Quarterly planning"),
      ).not.toBeInTheDocument();
    });

    it("labels a deleted origin instead of linking to it", () => {
      renderScreen({
        delegatedRuns: [
          session({
            id: "run-1",
            title: "Summarise the vendor contract",
            provenanceKind: "delegation",
            originChatId: "origin-gone",
          }),
        ],
      });

      fireEvent.click(screen.getByRole("tab", { name: "Delegated runs" }));

      expect(
        screen.getByText("From a conversation that no longer exists"),
      ).toBeInTheDocument();
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "/a/assistant-1/run-1");
    });

    it("flags the segment when a delegated run is waiting on the user", () => {
      useGenerationStatusStore
        .getState()
        .seedActionRequired("run-1", "2026-03-23T09:05:00.000Z");

      renderScreen({
        pastChats: [session({ id: "chat-1" })],
        delegatedRuns: [session({ id: "run-1" })],
      });

      const tab = screen.getByRole("tab", { name: /Delegated runs/ });
      expect(
        within(tab).getByTestId("segmented-control-attention"),
      ).toHaveTextContent("Action required");
      expect(tab).toHaveAccessibleName("Delegated runs Action required");
    });

    it("leaves the segment unflagged while no delegated run needs anything", () => {
      useGenerationStatusStore
        .getState()
        .seedRunning("chat-1", "2026-03-23T09:05:00.000Z");

      renderScreen({
        pastChats: [session({ id: "chat-1" })],
        delegatedRuns: [session({ id: "run-1" })],
      });

      expect(
        screen.queryByTestId("segmented-control-attention"),
      ).not.toBeInTheDocument();
    });
  });
});
