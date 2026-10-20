import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { chatInput } = vi.hoisted(() => ({
  chatInput: vi.fn((_props: Record<string, unknown>) => null),
}));

vi.mock("@erato/frontend/library", () => ({ ChatInput: chatInput }));

import { AddinChatInputCore } from "../AddinChatInputCore";

describe("AddinChatInputCore", () => {
  it("forwards ordinary sends and files without host action context", () => {
    const onSendMessage = vi.fn();
    const uploadFiles = vi.fn(async () => []);
    render(
      <AddinChatInputCore
        onSendMessage={onSendMessage}
        uploadFiles={uploadFiles}
        maxFiles={5}
      />,
    );

    expect(chatInput).toHaveBeenCalled();
    const props = chatInput.mock.calls.at(-1)?.[0];
    expect(props).toMatchObject({
      onSendMessage,
      uploadFiles,
      maxFiles: 5,
      showControls: true,
      showFileTypes: true,
    });
    expect(props).not.toHaveProperty("actionFacet");
    expect(props).not.toHaveProperty("sendItemIdentity");
  });

  it("hands the host's context items to the composer as they are", () => {
    const contextItems = [
      {
        id: "word-document",
        kind: "word.document",
        origin: "ambient" as const,
        dismissScope: "chat" as const,
        state: "included" as const,
        label: "report.docx",
        icon: "document",
      },
    ];
    render(
      <AddinChatInputCore
        onSendMessage={vi.fn()}
        contextItems={contextItems}
      />,
    );

    expect(chatInput.mock.calls.at(-1)?.[0].contextItems).toBe(contextItems);
  });

  it("hands the host's modes to the composer as they are", () => {
    const composerModes = [
      {
        id: "outlook.scheduling",
        label: "Scheduling",
        icon: "clock",
        endLabel: "End scheduling",
        onEnd: vi.fn(),
      },
    ];
    render(
      <AddinChatInputCore
        onSendMessage={vi.fn()}
        composerModes={composerModes}
      />,
    );

    expect(chatInput.mock.calls.at(-1)?.[0].composerModes).toBe(composerModes);
  });

  it("hands the host's notice, or its null, to the composer as it is", () => {
    const composerNotice = {
      id: "word.send.slowCapture",
      tone: "info" as const,
      text: "Word is still handing over the document.",
    };
    const { rerender } = render(
      <AddinChatInputCore
        onSendMessage={vi.fn()}
        composerNotice={composerNotice}
      />,
    );
    expect(chatInput.mock.calls.at(-1)?.[0].composerNotice).toBe(
      composerNotice,
    );

    rerender(
      <AddinChatInputCore onSendMessage={vi.fn()} composerNotice={null} />,
    );
    expect(chatInput.mock.calls.at(-1)?.[0].composerNotice).toBeNull();
  });
});
