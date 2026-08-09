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
});
