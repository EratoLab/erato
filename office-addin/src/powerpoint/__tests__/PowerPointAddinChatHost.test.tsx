import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PowerPointAddinChatHost } from "../PowerPointAddinChatHost";

import type { AddinChatController } from "../../core/AddinChatCore";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  rerunRef: undefined as { current: boolean } | undefined,
}));

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useUploadFeature: () => ({
      enabled: true,
      maxSizeBytes: 1024,
      maxSizeFormatted: "1 KB",
    }),
    useConversationDropzone: () => ({ isDragActive: false }),
  });
});
vi.mock("../../core/AddinChatCore", () => ({
  AddinChatCoreView: ({
    renderInput,
  }: {
    renderInput: (props: unknown) => ReactNode;
  }) => <>{renderInput({})}</>,
}));
vi.mock("../components/PowerPointChatInput", () => ({
  PowerPointChatInput: ({ rerunRef }: { rerunRef?: { current: boolean } }) => {
    mocks.rerunRef = rerunRef;
    return null;
  },
}));

afterEach(cleanup);

describe("PowerPoint host", () => {
  it("marks a regenerate and an edit as a rerun for the composer", () => {
    const controller = {
      hostCallbacksRef: { current: {} },
      chatInputControls: { addUploadedFiles: () => {} },
    } as unknown as AddinChatController;
    render(<PowerPointAddinChatHost controller={controller} />);
    expect(mocks.rerunRef).toEqual({ current: false });
    controller.hostCallbacksRef.current.beforeRegenerate?.("answer-1");
    expect(mocks.rerunRef!.current).toBe(true);
    mocks.rerunRef!.current = false;
    controller.hostCallbacksRef.current.beforeEdit?.("question-1");
    expect(mocks.rerunRef!.current).toBe(true);
  });
});
