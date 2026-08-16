import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ChatInputAddControls } from "../ChatInputAddControls";

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

function renderControls(props: Partial<{ uploadDisabled: boolean }> = {}) {
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
});
