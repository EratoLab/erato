import { i18n, Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import { FileTypeUtil } from "@/utils/fileTypes";

import { AssistantWelcomeScreen } from "./AssistantWelcomeScreen";

import type { AssistantWithFiles } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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
      screen.getByText("Start typing below to begin a new conversation"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("assistant-welcome-screen-default").className,
    ).toContain("w-full");
  });

  it("renders the edit assistant settings action as a secondary button", () => {
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

    expect(
      screen.getByRole("button", { name: "Edit Assistant Settings" }),
    ).toHaveClass(
      "bg-theme-bg-secondary",
      "border",
      "border-theme-border",
      "text-theme-fg-secondary",
    );
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

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent(
      "Some default files are inaccessible due to missing permissions.",
    );
    expect(
      screen.getByRole("link", { name: "owner@example.com" }),
    ).toHaveAttribute("href", "mailto:owner@example.com");
  });
});
