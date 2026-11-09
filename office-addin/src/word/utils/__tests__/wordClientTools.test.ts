import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWordClientTools } from "../wordClientTools";
import {
  wordDocumentReadSession,
  WORD_READ_TOOL,
} from "../wordDocumentReadTool";

import type {
  ClientToolExecutor,
  ClientToolExecutorOptions,
} from "@erato/frontend/library";

const mocks = vi.hoisted(() => ({
  registered: [] as {
    name: string;
    executor: ClientToolExecutor;
    options?: ClientToolExecutorOptions;
  }[],
}));
vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    registerClientToolExecutor: (
      name: string,
      executor: ClientToolExecutor,
      _isAvailable?: () => boolean,
      options?: ClientToolExecutorOptions,
    ) => {
      mocks.registered.push({ name, executor, options });
      return () => {};
    },
  });
});

afterEach(() => {
  mocks.registered.length = 0;
  vi.restoreAllMocks();
});

const grant = {
  ownerChatId: "owner-chat",
  ownerMessageId: "owner-message",
  requestingChatId: "task-chat",
  requestingMessageId: "task-message",
  contextRef: "snapshot",
};
const task = {
  toolCallId: "c",
  chatId: "task-chat",
  messageId: "task-message",
};

describe("Word client tool registration", () => {
  it("lets only the document read take delegated tasks' calls, and registers it last", () => {
    registerWordClientTools({
      readEnabled: () => true,
      bindingIdentity: () => "identity",
    });
    const read = mocks.registered.at(-1)!;
    expect(read.name).toBe(WORD_READ_TOOL);
    expect(read.options).toMatchObject({
      acceptsGrantCalls: true,
      checksApprovalScope: expect.any(Function),
      anchorsApprovalScope: expect.any(Function),
    });
    expect(
      mocks.registered
        .slice(0, -1)
        .map(({ name, options }) => [name, !!options?.acceptsGrantCalls]),
    ).toEqual([
      ["word_read_comments", false],
      ["word_submit_comment_changes", false],
      ["submit_document_plan", false],
    ]);
  });

  it("hands a task's call to the session while document inclusion is off, where a cleared capture refuses it", async () => {
    const execute = vi.spyOn(wordDocumentReadSession, "execute");
    registerWordClientTools({
      readEnabled: () => false,
      bindingIdentity: () => undefined,
    });
    const read = mocks.registered.at(-1)!.executor;
    expect(await read({}, task)).toEqual({
      ok: false,
      error: "Document inclusion is off.",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(await read({}, { ...task, hostGrant: grant })).toMatchObject({
      ok: false,
      validationErrors: [{ code: "capture-unavailable" }],
      submissionFeedback: { terminal: true },
    });
  });
});
