import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ChatInputAddControls } from "../ChatInputAddControls";
import { buildAssistantMentionSection } from "../assistantMentionSection";
import { buildMcpToolsSection } from "../mcpToolsSection";

import type { AddMenuSection } from "../ChatInputAddMenu";
import type { ChatAddMenuExtraContentProps } from "@/config/componentRegistry";

vi.mock("@/hooks/files/useChatFileSources", () => ({
  useChatFileSources: () => ({
    isProcessing: false,
    fileSourceItems: [],
    onSelectFiles: vi.fn(),
    dropzoneRootProps: (props: object = {}) => props,
    dropzoneInputProps: (props: object = {}) => props,
    cloudPickerProps: null,
  }),
}));

const seenExtraContentProps: ChatAddMenuExtraContentProps[] = [];
function ProbeExtraContent(props: ChatAddMenuExtraContentProps) {
  seenExtraContentProps.push(props);
  return <div data-testid="probe-extra-content" />;
}

function renderControls(
  props: Partial<{
    uploadDisabled: boolean;
    assistantSection: AddMenuSection;
    mcpToolsSection: AddMenuSection;
  }> = {},
) {
  return render(
    <ChatInputAddControls
      canUpload
      upload={{ message: "" }}
      facets={[]}
      selectedFacetIds={[]}
      onToggleFacet={() => {}}
      {...props}
    />,
  );
}

describe("ChatInputAddControls", () => {
  const previousExtraContent = componentRegistry.ChatAddMenuExtraContent;

  afterEach(() => {
    componentRegistry.ChatAddMenuExtraContent = previousExtraContent;
    seenExtraContentProps.length = 0;
  });

  // Host rows add files through onSelectFiles, so they must see the
  // attachment-limit state — overflow past the limit is silently discarded
  // by the composer merge, not rejected.
  it("forwards the upload-limit state to host extra content", () => {
    componentRegistry.ChatAddMenuExtraContent = ProbeExtraContent;

    renderControls({ uploadDisabled: true });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    expect(screen.getByTestId("probe-extra-content")).toBeInTheDocument();
    const props = seenExtraContentProps.at(-1);
    expect(props?.uploadDisabled).toBe(true);
    expect(props?.disabled).toBe(false);
  });

  it("leaves host extra content enabled below the limit", () => {
    componentRegistry.ChatAddMenuExtraContent = ProbeExtraContent;

    renderControls();
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const props = seenExtraContentProps.at(-1);
    expect(props?.uploadDisabled).toBe(false);
    expect(props?.disabled).toBe(false);
  });

  // Both rows open a dialog that focuses itself: the menu's usual delayed
  // close would return focus to the "+" trigger behind the overlay.
  it("renders the assistants as one row that opens their dialog at once", () => {
    const onOpen = vi.fn();
    renderControls({
      assistantSection: buildAssistantMentionSection({
        suggested: [{ id: "a-1", name: "Researcher" }],
        onOpen,
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const row = screen.getByTestId("chat-input-add-menu-extra-ask-assistant");
    expect(row).toHaveTextContent("Ask an assistant…");
    expect(row).toHaveTextContent("Researcher");

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the connectors as one row with their summary that opens their dialog at once", () => {
    const onOpen = vi.fn();
    renderControls({
      mcpToolsSection: buildMcpToolsSection({
        servers: [
          {
            id: "linear",
            display_name: "Linear",
            connection_status: "SUCCESS",
            authentication_mode: "oauth2",
          },
          {
            id: "jira",
            display_name: "Jira",
            connection_status: "NEEDS_AUTHENTICATION",
            authentication_mode: "oauth2",
          },
        ],
        disabledServerIds: ["linear"],
        writeToolsEnabled: true,
        onOpen,
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const row = screen.getByTestId("chat-input-add-menu-extra-connectors");
    expect(row).toHaveAttribute("role", "menuitem");
    expect(row).toHaveTextContent("Connectors…");
    expect(row).toHaveTextContent("Linear off · 1 to connect");

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("orders the connectors before the assistants, without group headers", () => {
    renderControls({
      assistantSection: buildAssistantMentionSection({
        suggested: [{ id: "a-1", name: "Researcher" }],
        onOpen: vi.fn(),
      }),
      mcpToolsSection: buildMcpToolsSection({
        servers: [],
        writeToolsEnabled: false,
        onOpen: vi.fn(),
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const rows = screen
      .getAllByTestId(/^chat-input-add-menu-extra-/)
      .map((row) => row.dataset.testid);
    expect(rows).toEqual([
      "chat-input-add-menu-extra-connectors",
      "chat-input-add-menu-extra-ask-assistant",
    ]);
    expect(screen.queryByText("Assistants")).not.toBeInTheDocument();
  });
});
