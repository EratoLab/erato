import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasClientToolCallBeenAnswered,
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
  trackClientToolCallAbort,
} from "@/hooks/chat/clientToolExecutors";

import {
  CLIENT_TOOL_OPERATION_KIND,
  ClientToolOperationHandler,
  toOperationResult,
} from "./clientToolHandler";

import type {
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@/hooks/chat/clientToolExecutors";
import type {
  ClaimClientOperationResponse,
  ExecutorBinding,
  OperationRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const binding: ExecutorBinding = {
  device_id: "device-one-0000000",
  realm: "office-addin",
  host_context: { kind: "outlook_mailbox", identity: "a".repeat(64) },
};
const request: OperationRequest = {
  attempt_id: "00000000-0000-4000-8000-0000000000a1",
  operation_id: "outlook/fetch_availability",
  kind: CLIENT_TOOL_OPERATION_KIND,
  account_id: "00000000-0000-4000-8000-000000000001",
  chat_id: "00000000-0000-4000-8000-0000000000c1",
  message_id: "00000000-0000-4000-8000-0000000000e1",
  tool_call_id: "avail-call",
  realm: "office-addin",
  consent: "none",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  input: { lookahead_days: 7 },
  binding,
};
const claim: ClaimClientOperationResponse = {
  claim_token: "claim",
  expires_at: new Date(Date.now() + 120_000).toISOString(),
};
const identity = {
  attempt_id: request.attempt_id,
  operation_id: request.operation_id,
  executor: binding,
};
const lineage = {
  owner_chat_id: request.chat_id,
  owner_message_id: request.message_id,
  requesting_chat_id: "00000000-0000-4000-8000-0000000000c2",
  requesting_message_id: "00000000-0000-4000-8000-0000000000e2",
};
const grantRequest: OperationRequest = {
  ...request,
  chat_id: lineage.requesting_chat_id,
  message_id: lineage.requesting_message_id,
  lineage,
};
const declined: ClientToolExecutionResult = {
  ok: false,
  error: "The user declined",
  validationErrors: [{ code: "declined", path: "", message: "Declined" }],
};

afterEach(resetClientToolRegistryForTests);

describe("toOperationResult", () => {
  it("carries Word read diagnostics and lost-capture feedback in a rejection", () => {
    const word = {
      ...request,
      binding: {
        ...binding,
        host_context: { kind: "word_document", identity: "b".repeat(64) },
      },
    };
    const issues = [
      {
        path: "/snapshot",
        code: "capture-unavailable",
        message: "Capture lost",
      },
    ];
    const feedback = { terminal: true, recovery: "cannot_continue" as const };
    expect(
      toOperationResult(word, {
        ok: false,
        error: "Lost",
        validationErrors: issues,
        submissionFeedback: feedback,
      }),
    ).toEqual({
      ...identity,
      executor: word.binding,
      outcome: "rejected",
      error: { code: "validation_failed", validation: { issues, feedback } },
    });
  });

  it.each<[string, ClientToolExecutionResult, object]>([
    [
      "a value",
      { ok: true, result: { busy: [] } },
      {
        outcome: "succeeded",
        result: { type: "value", value: { busy: [] } },
      },
    ],
    [
      "an empty success",
      { ok: true, result: undefined },
      { outcome: "succeeded", result: { type: "value", value: null } },
    ],
    [
      "validation errors",
      {
        ok: false,
        error: "bad input",
        validationErrors: [
          { code: "maximum", path: "/lookahead_days", message: "too big" },
        ],
      },
      { outcome: "rejected", error: { code: "validation_failed" } },
    ],
    [
      "an executor error",
      { ok: false, error: "EWS 9020" },
      {
        outcome: "failed",
        error: { code: "execution_failed", message: "EWS 9020" },
      },
    ],
    [
      "a blank executor error",
      { ok: false, error: " \n\t " },
      { outcome: "failed", error: { code: "execution_failed" } },
    ],
    [
      "a local-only disposition",
      { ok: true, disposition: "local_only" },
      { outcome: "failed", error: { code: "execution_failed" } },
    ],
    [
      "uploaded files",
      { ok: true, result: { busy: [] }, fileUploadIds: ["file"] },
      { outcome: "failed", error: { code: "execution_failed" } },
    ],
  ])("maps %s", (_name, outcome, expected) => {
    expect(toOperationResult(request, outcome)).toEqual({
      ...identity,
      ...expected,
    });
  });

  it("cleans control characters and keeps at most 1024 characters", () => {
    expect(
      toOperationResult(request, { ok: false, error: "  a\r\nb\u0000c  " })
        .error,
    ).toEqual({ code: "execution_failed", message: "a  b c" });
    const long = toOperationResult(request, {
      ok: false,
      error: `${"é".repeat(1023)}\u{1F600}\u{1F600}`,
    }).error?.message;
    expect(Array.from(long ?? "")).toHaveLength(1024);
    expect(long?.endsWith("\u{1F600}")).toBe(true);
  });

  it("reports a decline on the device only for a task's call", () => {
    expect(toOperationResult(grantRequest, declined)).toEqual({
      ...identity,
      outcome: "rejected",
      error: { code: "declined" },
    });
    expect(toOperationResult(request, declined)).toEqual({
      ...identity,
      outcome: "rejected",
      error: { code: "validation_failed" },
    });
  });

  it("carries the request's base revision only when it has one", () => {
    expect(
      toOperationResult(
        { ...request, base_revision: 3 },
        { ok: true, result: 1 },
      ),
    ).toMatchObject({ base_revision: 3 });
    expect(
      toOperationResult(request, { ok: true, result: 1 }),
    ).not.toHaveProperty("base_revision");
  });
});

describe("ClientToolOperationHandler", () => {
  function handler(
    run: ClientToolExecutor = async () => ({ ok: true, result: { busy: [] } }),
    ready = () => true,
  ) {
    return new ClientToolOperationHandler(
      "fetch_availability",
      run,
      () => binding,
      ready,
    );
  }

  it("matches its own tool by bare name within its kind, as the live call does", () => {
    const subject = handler();
    expect(subject.matches(request)).toBe(true);
    expect(
      subject.matches({
        ...request,
        operation_id: "client/fetch_availability",
      }),
    ).toBe(true);
    expect(
      subject.matches({ ...request, operation_id: "outlook/create_draft" }),
    ).toBe(false);
    expect(subject.matches({ ...request, kind: "local_evidence.v1" })).toBe(
      false,
    );
  });

  it("offers its binding only while the pane can run the tool", () => {
    let ready = false;
    const subject = handler(undefined, () => ready);
    expect(subject.executor()).toBeUndefined();
    ready = true;
    expect(subject.executor()).toEqual(binding);
  });

  it("defers while the live call for the same tool call runs here", () => {
    const subject = handler();
    expect(subject.defer(request)).toBe(false);
    trackClientToolCallAbort(request.tool_call_id, request.chat_id);
    expect(subject.defer(request)).toBe(true);
  });

  it("runs the parked input and answers with the request's own binding", async () => {
    const run = vi.fn<ClientToolExecutor>(async () => ({
      ok: true,
      result: { busy: [] },
    }));
    const signal = new AbortController().signal;
    const result = await handler(run).execute(request, claim, signal);
    expect(run).toHaveBeenCalledWith(
      { lookahead_days: 7 },
      {
        toolCallId: "avail-call",
        messageId: request.message_id,
        chatId: request.chat_id,
        signal,
      },
    );
    expect(result.executor).toBe(request.binding);
    expect(result.outcome).toBe("succeeded");
    expect(hasClientToolCallBeenAnswered(request.tool_call_id)).toBe(true);
  });

  it("never matches a task's call unless the tool takes grant calls", () => {
    const subject = handler();
    registerClientToolExecutor("fetch_availability", vi.fn());
    expect(subject.matches(grantRequest)).toBe(false);
    expect(subject.matches(request)).toBe(true);
    registerClientToolExecutor("fetch_availability", vi.fn(), undefined, {
      acceptsGrantCalls: true,
    });
    expect(subject.matches(grantRequest)).toBe(true);
  });

  it("runs a claimed task's call under the grant its lineage carries", async () => {
    registerClientToolExecutor("fetch_availability", vi.fn(), undefined, {
      acceptsGrantCalls: true,
    });
    const run = vi.fn<ClientToolExecutor>(async () => ({
      ok: true,
      result: { busy: [] },
    }));
    const signal = new AbortController().signal;
    await handler(run).execute(
      { ...grantRequest, lineage: { ...lineage, context_ref: "v1" } },
      claim,
      signal,
    );
    expect(run).toHaveBeenCalledWith(
      { lookahead_days: 7 },
      {
        toolCallId: "avail-call",
        messageId: grantRequest.message_id,
        chatId: grantRequest.chat_id,
        signal,
        hostGrant: {
          ownerChatId: request.chat_id,
          ownerMessageId: request.message_id,
          requestingChatId: grantRequest.chat_id,
          requestingMessageId: grantRequest.message_id,
          contextRef: "v1",
        },
      },
    );
  });

  it("answers a task's call to a tool that takes none without running it", async () => {
    registerClientToolExecutor("fetch_availability", vi.fn());
    const run = vi.fn<ClientToolExecutor>();
    const result = await handler(run).execute(
      grantRequest,
      claim,
      new AbortController().signal,
    );
    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "failed",
      error: { code: "execution_failed" },
    });
  });

  it("turns a thrown executor into a failure without its text", async () => {
    const result = await handler(async () => {
      throw new Error("PRIVATE stack detail");
    }).execute(request, claim, new AbortController().signal);
    expect(result).toEqual({
      ...identity,
      outcome: "failed",
      error: { code: "execution_failed" },
    });
  });

  it("does not answer after the coordinator is disposed", async () => {
    const controller = new AbortController();
    const pending = handler(async () => {
      controller.abort();
      return { ok: true, result: 1 };
    }).execute(request, claim, controller.signal);
    await expect(pending).rejects.toThrow();
  });
});
