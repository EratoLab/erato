import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ChatInputAddControls } from "../ChatInputAddControls";
import { buildAssistantMentionSection } from "../assistantMentionSection";

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
});
