import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWordClientOperations } from "../useWordClientOperations";

import type { ExecutorBinding } from "@erato/frontend/library";

const mocks = vi.hoisted(() => {
  class Handler {
    constructor(
      readonly name: string,
      readonly execute: unknown,
      readonly binding: () => ExecutorBinding | undefined,
    ) {}
  }
  return {
    Handler,
    unregister: vi.fn(),
    register: vi.fn(),
    registerHandler: vi.fn(),
    sweep: vi.fn(),
    execute: vi.fn(),
  };
});
vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    ClientToolOperationHandler: mocks.Handler,
    clientOperationDeviceId: () => "device",
    registerOperationExecutor: mocks.register,
    registerClientOperationHandler: mocks.registerHandler,
    requestClientOperationSweep: mocks.sweep,
  });
});
vi.mock("../../utils/wordDocumentReadTool", () => ({
  wordDocumentReadSession: { execute: mocks.execute },
  WORD_READ_TOOL: "read_document_blocks",
}));
vi.mock("../../utils/wordDocumentSubmission", () => ({
  WORD_SUBMIT_PLAN_TOOL: "submit_document_plan",
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.register.mockReturnValue(mocks.unregister);
  mocks.registerHandler.mockReturnValue(mocks.unregister);
});
afterEach(cleanup);

describe("Word client operation registration", () => {
  it("advertises both live tools with one pane binding but claims only reads", async () => {
    const { rerender, unmount } = renderHook(
      ({ document }) => useWordClientOperations(document),
      { initialProps: { document: "doc-one" } },
    );
    const binding = mocks.register.mock.calls[0][1] as () =>
      | ExecutorBinding
      | undefined;
    await waitFor(() =>
      expect(binding()?.host_context?.kind).toBe("word_document"),
    );
    const original = binding();
    expect(mocks.register.mock.calls.map(([name]) => name)).toEqual([
      "read_document_blocks",
      "submit_document_plan",
    ]);
    expect(mocks.registerHandler).toHaveBeenCalledTimes(1);
    const handler = mocks.registerHandler.mock.calls[0][0] as InstanceType<
      typeof mocks.Handler
    >;
    expect(handler.name).toBe("read_document_blocks");
    expect(handler.execute).toBe(mocks.execute);
    expect(handler.binding()).toEqual(original);
    rerender({ document: "doc-two" });
    expect(binding()).toBeUndefined();
    await waitFor(() => expect(binding()).toBeDefined());
    expect(binding()).not.toEqual(original);
    unmount();
    expect(binding()).toBeUndefined();
    expect(mocks.unregister).toHaveBeenCalledTimes(3);
  });
});
