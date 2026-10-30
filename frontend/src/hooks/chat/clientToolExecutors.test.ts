import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clientToolApprovalScopeAnchor,
  getChildClientToolHeaders,
  getClientToolExecutor,
  getClientToolHeaders,
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
  runClientToolCall,
} from "./clientToolExecutors";

import type {
  ClientToolApprovalScopeRef,
  ClientToolCallContext,
} from "./clientToolExecutors";

afterEach(resetClientToolRegistryForTests);

it("only advertises currently available tools, including after disconnection", async () => {
  let ready = false;
  const unregister = registerClientToolExecutor(
    "search_sidecar_index",
    async () => ({ ok: true, result: null }),
    () => ready,
  );
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe("");
  expect(getClientToolExecutor("search_sidecar_index")).toBeUndefined();
  ready = true;
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe(
    "search_sidecar_index",
  );
  ready = false;
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe("");
  unregister();
  ready = true;
  expect(getClientToolExecutor("search_sidecar_index")).toBeUndefined();
});

it("keeps legacy registrations available and prevents older cleanup removing a replacement", () => {
  const oldCleanup = registerClientToolExecutor(
    "fetch_availability",
    async () => ({ ok: true, result: 1 }),
  );
  registerClientToolExecutor("fetch_availability", async () => ({
    ok: true,
    result: 2,
  }));
  oldCleanup();
  expect(getClientToolHeaders()["X-Erato-Client-Tools"]).toBe(
    "fetch_availability",
  );
});

describe("approval scopes", () => {
  const read = async () => ({ ok: true as const, result: null });
  const documentScope: ClientToolApprovalScopeRef = {
    hostContext: "word_document",
    scopeId: "identity-1",
    covers: "document",
  };

  it("lists the grant tools that check a scope now, and none when no tool does", () => {
    let checks = true;
    registerClientToolExecutor("read_document_blocks", read, undefined, {
      acceptsGrantCalls: true,
      checksApprovalScope: () => checks,
    });
    registerClientToolExecutor("read_comments", read, undefined, {
      acceptsGrantCalls: true,
    });
    // A scope check on a tool that takes no grant calls covers nothing.
    registerClientToolExecutor("submit_plan", read, undefined, {
      checksApprovalScope: () => true,
    });
    expect(getChildClientToolHeaders()).toEqual({
      "X-Erato-Child-Client-Tools": "read_comments,read_document_blocks",
      "X-Erato-Scoped-Client-Tools": "read_document_blocks",
    });
    checks = false;
    expect(getChildClientToolHeaders()).toEqual({
      "X-Erato-Child-Client-Tools": "read_comments,read_document_blocks",
    });
  });

  it("drops a scoped tool once it is unavailable", () => {
    let ready = true;
    registerClientToolExecutor("read_document_blocks", read, () => ready, {
      acceptsGrantCalls: true,
      checksApprovalScope: () => true,
    });
    ready = false;
    expect(getChildClientToolHeaders()).toEqual({});
  });

  it("anchors a scope only where the tool checks scopes now", () => {
    let checks = true;
    const anchor = () => ({ journal: "j", seq: 1, events: true });
    const anchorsApprovalScope = vi.fn((scope: ClientToolApprovalScopeRef) =>
      scope.scopeId === "identity-1" ? anchor : undefined,
    );
    registerClientToolExecutor("read_document_blocks", read, undefined, {
      acceptsGrantCalls: true,
      checksApprovalScope: () => checks,
      anchorsApprovalScope,
    });
    expect(
      clientToolApprovalScopeAnchor("read_document_blocks", documentScope),
    ).toBe(anchor);
    expect(anchorsApprovalScope).toHaveBeenCalledWith(documentScope);
    expect(
      clientToolApprovalScopeAnchor("read_document_blocks", {
        ...documentScope,
        scopeId: "identity-2",
      }),
    ).toBeUndefined();
    expect(
      clientToolApprovalScopeAnchor("read_comments", documentScope),
    ).toBeUndefined();
    checks = false;
    expect(
      clientToolApprovalScopeAnchor("read_document_blocks", documentScope),
    ).toBeUndefined();
  });

  it("passes a covered call's approval to the handler with its grant", async () => {
    const execute = vi.fn(
      async (_input: unknown, _context?: ClientToolCallContext) => ({
        ok: true as const,
        result: null,
      }),
    );
    registerClientToolExecutor("read_document_blocks", execute, undefined, {
      acceptsGrantCalls: true,
      checksApprovalScope: () => true,
    });
    const position = { journal: "j", seq: 41, events: true };
    await runClientToolCall(
      "read_document_blocks",
      execute,
      {},
      { toolCallId: "call-1", messageId: "task-message", chatId: "task-chat" },
      {
        owner_chat_id: "parent-chat",
        owner_message_id: "parent-message",
        requesting_chat_id: "task-chat",
        requesting_message_id: "task-message",
        approval_scope: {
          approval_id: "approval-1",
          scope_id: "identity-1",
          position,
        },
      },
    );
    expect(execute.mock.calls[0][1]?.hostGrant?.approvalScope).toEqual({
      approvalId: "approval-1",
      scopeId: "identity-1",
      position,
    });
  });
});
