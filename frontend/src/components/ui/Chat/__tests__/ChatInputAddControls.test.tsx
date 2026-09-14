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

  it("renders the assistants section as menu rows", () => {
    const onSelect = vi.fn();
    renderControls({
      assistantSection: buildAssistantMentionSection({
        assistants: [{ id: "a-1", name: "Researcher" }],
        onSelect,
        onBrowse: vi.fn(),
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    expect(screen.getByText("Assistants")).toBeInTheDocument();
    expect(
      screen.getByTestId("chat-input-add-menu-extra-browse-assistants"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("chat-input-add-menu-extra-a-1"));
    expect(onSelect).toHaveBeenCalledWith({ id: "a-1", name: "Researcher" });
  });

  // The browse row opens a dialog that focuses itself: the menu's usual
  // delayed close would return focus to the "+" trigger behind the overlay.
  it("closes without the select delay when browse opens the dialog", () => {
    const onBrowse = vi.fn();
    renderControls({
      assistantSection: buildAssistantMentionSection({
        assistants: [{ id: "a-1", name: "Researcher" }],
        onSelect: vi.fn(),
        onBrowse,
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    fireEvent.click(
      screen.getByTestId("chat-input-add-menu-extra-browse-assistants"),
    );

    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the connectors write switch as a checkbox row that keeps the menu open", () => {
    const onToggleWriteTools = vi.fn();
    renderControls({
      mcpToolsSection: buildMcpToolsSection({
        writeToolsEnabled: true,
        onToggleWriteTools,
        onBrowse: vi.fn(),
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    expect(screen.getByText("Connectors")).toBeInTheDocument();
    const toggle = screen.getByTestId(
      "chat-input-add-menu-extra-allow-write-operations",
    );
    expect(toggle).toHaveAttribute("role", "menuitemcheckbox");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "Off, only tools the server marks read-only are offered.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggleWriteTools).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("orders the connectors between the tools and the assistants", () => {
    renderControls({
      assistantSection: buildAssistantMentionSection({
        assistants: [{ id: "a-1", name: "Researcher" }],
        onSelect: vi.fn(),
        onBrowse: vi.fn(),
      }),
      mcpToolsSection: buildMcpToolsSection({
        writeToolsEnabled: false,
        onToggleWriteTools: vi.fn(),
        onBrowse: vi.fn(),
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const rows = screen
      .getAllByTestId(/^chat-input-add-menu-extra-/)
      .map((row) => row.dataset.testid);
    expect(rows).toEqual([
      "chat-input-add-menu-extra-allow-write-operations",
      "chat-input-add-menu-extra-browse-tools",
      "chat-input-add-menu-extra-a-1",
      "chat-input-add-menu-extra-browse-assistants",
    ]);
  });

  it("renders each server as a checkbox row ahead of the write switch and flips it in place", () => {
    const onToggleServer = vi.fn();
    const onConnect = vi.fn();
    renderControls({
      mcpToolsSection: buildMcpToolsSection({
        writeToolsEnabled: true,
        onToggleWriteTools: vi.fn(),
        onBrowse: vi.fn(),
        servers: [
          {
            id: "linear",
            connection_status: "SUCCESS",
            authentication_mode: "oauth2",
          },
          {
            id: "jira",
            connection_status: "NEEDS_AUTHENTICATION",
            authentication_mode: "oauth2",
          },
        ],
        disabledServerIds: ["linear"],
        onToggleServer,
        onConnect,
      }),
    });
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"));

    const rows = screen
      .getAllByTestId(/^chat-input-add-menu-extra-/)
      .map((row) => row.dataset.testid);
    expect(rows).toEqual([
      "chat-input-add-menu-extra-server-linear",
      "chat-input-add-menu-extra-server-jira",
      "chat-input-add-menu-extra-allow-write-operations",
      "chat-input-add-menu-extra-browse-tools",
    ]);

    const linear = screen.getByTestId(
      "chat-input-add-menu-extra-server-linear",
    );
    expect(linear).toHaveAttribute("role", "menuitemcheckbox");
    expect(linear).toHaveAttribute("aria-checked", "false");
    fireEvent.click(linear);
    expect(onToggleServer).toHaveBeenCalledWith("linear");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Awaiting authorization: a plain row that leads to connecting, and it
    // closes the menu at once like every row that opens a dialog.
    const jira = screen.getByTestId("chat-input-add-menu-extra-server-jira");
    expect(jira).toHaveAttribute("role", "menuitem");
    expect(jira).toHaveTextContent("Needs authentication");
    fireEvent.click(jira);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
