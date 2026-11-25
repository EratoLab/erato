import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  examplePlan,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { forgetWordAcceptedPlansForTests } from "../wordAcceptedSubmissions";
import { createWordApplyPlanExecutor } from "../wordApplyCall";
import {
  markWordApplyDone,
  markWordApplyWriting,
  WORD_APPLY_CALLS_KEY,
} from "../wordApplyCallMarkers";
import { WORD_CLIENT_ACTIONS } from "../wordClientActions";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { wordMessageContext } from "../wordMessageContext";
import { setWordWriteBridge } from "../wordWriteBridge";

import type { WordDocumentApplyResult } from "../wordApplyDocumentPlan";
import type { WordClientActionRun } from "../wordClientActions";
import type * as WordPlanApplyModule from "../wordPlanApply";
import type { WordMessageContext, WordWriteBridge } from "../wordWriteBridge";
import type {
  ClientToolCallContext,
  ContentPart,
  Message,
} from "@erato/frontend/library";

const routing = vi.hoisted(() => ({
  override: undefined as
    | ((
        real: WordPlanApplyModule.WordPlanRouting | undefined,
      ) => WordPlanApplyModule.WordPlanRouting | undefined)
    | undefined,
  coauthors: false,
}));

vi.mock("../wordPlanApply", async (importOriginal) => {
  const real = await importOriginal<typeof WordPlanApplyModule>();
  return {
    ...real,
    wordPlanRouting: (...args: Parameters<typeof real.wordPlanRouting>) => {
      const computed = real.wordPlanRouting(...args);
      return routing.override ? routing.override(computed) : computed;
    },
    wordPlanChecksCoauthors: () => routing.coauthors,
  };
});

const coauthoring = vi.hoisted(() => ({
  state: undefined as { othersEditing?: boolean } | undefined,
}));
vi.mock("../wordCoauthoring", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readWordCoauthoring: () => Promise.resolve(coauthoring.state),
}));

const estimate = vi.hoisted(() => vi.fn());
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchTokenUsageEstimate: estimate,
}));
const images = vi.hoisted(() => vi.fn());
vi.mock("../wordImageAssets", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  captureWordImageAssets: images,
}));

const submission: ClientToolCallContext = {
  toolCallId: "submit-A",
  messageId: "message-A",
  chatId: "chat-A",
};
const applyContext = (
  overrides: Partial<ClientToolCallContext> = {},
): ClientToolCallContext => ({
  toolCallId: "submit-A.apply",
  messageId: "message-A",
  chatId: "chat-A",
  ...overrides,
});
const applyInput = (confirmation: Record<string, unknown> | null = null) => ({
  proposal_call_id: "submit-A",
  draft_id: "submit-A",
  confirmation,
});

function bridgeFor(
  identity: string | null,
  stored: WordMessageContext = {},
): WordWriteBridge {
  let busy = false;
  return {
    documentIdentity: () => identity,
    updateReview: vi.fn(),
    beginOperation: () => (busy ? false : (busy = true)),
    endOperation: () => {
      busy = false;
    },
    holdOperationUntil: vi.fn(),
    setRevertSlot: vi.fn(),
    invalidateLocations: vi.fn(),
    messageContext: () => stored,
    captureFor: () => undefined,
    reviewFor: () => undefined,
    locationGeneration: () => 0,
  };
}

const applied = (
  result: Partial<WordDocumentApplyResult> = {},
): WordClientActionRun => ({
  ok: (result.status ?? "applied") === "applied",
  outcomes: [],
  snapshotOoxml: null,
  documentPlanResult: {
    status: "applied",
    before: "<before/>",
    ...result,
  },
});

async function accepted(readEnabled = true) {
  const session = new WordDocumentReadSession(() =>
    Promise.reject(new Error("no capture in this test")),
  );
  const snapshot = readySnapshot();
  session.activate(snapshot, submission, undefined, { request: "Do it" });
  await session.execute(
    { snapshot: snapshot.token },
    { ...submission, toolCallId: "read-A" },
  );
  const plan = examplePlan(snapshot.token);
  plan.readToken = snapshot.readToken!;
  const receipt = await createWordDocumentSubmissionExecutor(session)(
    plan,
    submission,
  );
  expect(receipt.ok).toBe(true);
  const entry = WORD_CLIENT_ACTIONS.get("word.apply_document_plan")!;
  const execute = vi.spyOn(entry, "execute");
  const bridge = bridgeFor("doc-A");
  return {
    session,
    snapshot,
    execute,
    bridge,
    apply: createWordApplyPlanExecutor({
      session,
      readEnabled: () => readEnabled,
      bridge: () => bridge,
    }),
  };
}

beforeEach(() => {
  estimate.mockReset();
  images.mockReset();
  routing.override = undefined;
  routing.coauthors = false;
  coauthoring.state = undefined;
  localStorage.clear();
  forgetWordAcceptedPlansForTests();
});
afterEach(() => {
  setWordWriteBridge(null);
  vi.restoreAllMocks();
});

describe("the server's apply of an accepted plan", () => {
  it("writes the plan once per call id, then reserves the next copy", async () => {
    const { apply, execute, session, snapshot } = await accepted();
    execute.mockImplementation(async ({ onBeforeDocumentWrite }) => {
      onBeforeDocumentWrite?.("<before/>");
      snapshot.used = true;
      return applied();
    });
    const [first, again] = await Promise.all([
      apply(applyInput(), applyContext()),
      apply(applyInput(), applyContext()),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(again).toBe(first);
    expect(first).toMatchObject({
      ok: true,
      result: { status: "applied", verified: true, undo_steps: 1 },
    });
    const token = (first as { result: { snapshot: string } }).result.snapshot;
    expect(token).toEqual(expect.any(String));
    expect(token).not.toBe(snapshot.token);
    expect(session.liveCapture(snapshot.token)).toBeDefined();
    // A redelivery after a reload finds the stored result, not a second write.
    const reloaded = createWordApplyPlanExecutor({
      session,
      readEnabled: () => true,
      bridge: () => bridgeFor("doc-A"),
    });
    expect(await reloaded(applyInput(), applyContext())).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<WordDocumentApplyResult>, Record<string, unknown>]>([
    [
      "interrupted as partial, not verified",
      { status: "interrupted" },
      {
        status: "partial",
        verified: false,
        reason: "not_verified",
        needs_follow_up: true,
      },
    ],
    [
      "stale as stale",
      { status: "stale", before: undefined },
      { status: "stale", reason: "document_changed" },
    ],
    [
      "another block as failed",
      {
        status: "blocked",
        before: undefined,
        diagnostic: { stage: "write", reason: "not-allowed" },
      },
      { status: "failed", reason: "blocked:not-allowed" },
    ],
  ])("maps %s", async (_name, result, expected) => {
    const { apply, execute } = await accepted();
    execute.mockResolvedValue(applied(result));
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      ok: true,
      result: expected,
    });
  });

  it("asks on screen when replacing the whole document needs a confirmation, writing nothing", async () => {
    const { apply, execute } = await accepted();
    routing.override = (real) =>
      real && { ...real, write: { write: "confirm" } as never };
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "needs_decision", reason: "whole_document" },
    });
    expect(execute).not.toHaveBeenCalled();
    // The same call runs again once the user confirmed on screen.
    execute.mockResolvedValue(applied());
    expect(
      await apply(applyInput({ importConfirmed: true }), applyContext()),
    ).toMatchObject({ result: { status: "applied" } });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ importConfirmed: true }),
    );
  });

  it("asks on screen when Word finds the whole-document block only while writing", async () => {
    const { apply, execute } = await accepted();
    execute.mockResolvedValue(
      applied({
        status: "blocked",
        before: undefined,
        diagnostic: { stage: "validate", reason: "import-needs-confirmation" },
      }),
    );
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "needs_decision", reason: "whole_document" },
    });
  });

  it("asks on screen for comment threads the plan removes", async () => {
    const { apply, execute } = await accepted();
    routing.override = (real) =>
      real && {
        ...real,
        comments: {
          removals: [{}],
          fingerprint: "fp-1",
          threads: [],
        } as never,
      };
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      result: { status: "needs_decision", reason: "comment_removals" },
    });
    execute.mockResolvedValue(applied());
    expect(
      await apply(
        applyInput({ commentRemovalsConfirmed: "fp-1" }),
        applyContext(),
      ),
    ).toMatchObject({ result: { status: "applied" } });
  });

  it("asks on screen when a co-author joined since the card was read", async () => {
    const { apply, execute } = await accepted();
    routing.coauthors = true;
    coauthoring.state = { othersEditing: true };
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      result: { status: "needs_decision", reason: "coauthors" },
    });
    expect(execute).not.toHaveBeenCalled();
    execute.mockResolvedValue(applied());
    expect(
      await apply(applyInput({ coauthors: "editing" }), applyContext()),
    ).toMatchObject({ result: { status: "applied" } });
  });

  it("refuses another document without writing", async () => {
    const { session, execute } = await accepted();
    const apply = createWordApplyPlanExecutor({
      session,
      readEnabled: () => true,
      bridge: () => bridgeFor("doc-B"),
    });
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "unavailable", reason: "other_document" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops before the write begins, and finishes a write that began", async () => {
    const { apply, execute } = await accepted();
    const stop = new AbortController();
    stop.abort();
    expect(
      await apply(applyInput(), applyContext({ signal: stop.signal })),
    ).toMatchObject({ result: { status: "failed", reason: "stopped" } });
    expect(execute).not.toHaveBeenCalled();

    forgetWordAcceptedPlansForTests();
    const again = await accepted();
    const later = new AbortController();
    again.execute.mockImplementation(async ({ onBeforeDocumentWrite }) => {
      onBeforeDocumentWrite?.("<before/>");
      later.abort();
      return applied();
    });
    expect(
      await again.apply(
        applyInput(),
        applyContext({ toolCallId: "submit-A.apply-2", signal: later.signal }),
      ),
    ).toMatchObject({ result: { status: "applied" } });
  });

  it("leaves no copy a stopped change could still be planned on", async () => {
    const { apply, snapshot } = await accepted();
    const stop = new AbortController();
    stop.abort();
    const answer = await apply(
      applyInput(),
      applyContext({ signal: stop.signal }),
    );
    expect(answer).toMatchObject({ result: { snapshot: expect.any(String) } });
    expect(snapshot.used).toBe(true);
  });

  it("marks the write as started before it begins", async () => {
    const { apply, execute } = await accepted();
    let marker: unknown;
    execute.mockImplementation(async ({ onBeforeDocumentWrite }) => {
      onBeforeDocumentWrite?.("<before/>");
      marker = JSON.parse(localStorage.getItem(WORD_APPLY_CALLS_KEY)!);
      return applied();
    });
    await apply(applyInput(), applyContext());
    expect(marker).toEqual([
      { callId: "submit-A.apply", state: "writing", identity: "doc-A" },
    ]);
    expect(JSON.parse(localStorage.getItem(WORD_APPLY_CALLS_KEY)!)).toEqual([
      expect.objectContaining({ callId: "submit-A.apply", state: "done" }),
    ]);
  });
});

describe("a change declined in the decision place", () => {
  const declined = (status: string): ContentPart[] =>
    [
      {
        content_type: "tool_use",
        tool_call_id: "submit-A",
        tool_name: "submit_document_plan",
        status: "success",
        output: { apply: { call_id: "submit-A.apply" }, result: {} },
      },
      {
        content_type: "tool_use",
        tool_call_id: "submit-A.apply",
        tool_name: "apply_document_plan",
        status: "error",
        output: { status },
      },
    ] as unknown as ContentPart[];

  it.each(["rejected", "change_requested"])(
    "lets the same answer submit another plan once the change was %s",
    async (status) => {
      const { snapshot, session, bridge } = await accepted();
      const submit = createWordDocumentSubmissionExecutor(session);
      const again = () => {
        const plan = examplePlan(snapshot.token);
        plan.readToken = snapshot.readToken!;
        return plan;
      };
      setWordWriteBridge(bridge);
      expect(
        await submit(again(), { ...submission, toolCallId: "submit-B" }),
      ).toMatchObject({
        ok: false,
        error: "A document plan has already been accepted for this request.",
      });
      setWordWriteBridge({
        ...bridge,
        messageContext: () => ({ content: declined(status) }),
      });
      expect(
        await submit(again(), { ...submission, toolCallId: "submit-C" }),
      ).toMatchObject({ ok: true });
    },
  );
});

describe("an apply without its copy", () => {
  const reloadedPane = (stored: WordMessageContext, readEnabled = true) => {
    const session = new WordDocumentReadSession(async () => ({
      snapshot: readySnapshot(),
      capture: {},
      reusedVerifiedBody: false,
    }));
    return {
      session,
      apply: createWordApplyPlanExecutor({
        session,
        readEnabled: () => readEnabled,
        bridge: () => bridgeFor("doc-A", stored),
      }),
    };
  };

  it("after a reload answers stale with a new copy built from the stored request", async () => {
    const { apply, session } = reloadedPane({
      identity: "doc-A",
      requestText: "Shorten chapter 3",
    });
    const answer = await apply(applyInput(), applyContext());
    expect(answer).toMatchObject({
      ok: true,
      result: {
        status: "stale",
        reason: "capture_lost",
        snapshot: expect.any(String),
      },
    });
    expect(session.liveCapture(undefined)).toBeUndefined();
  });

  it("after a reload takes the request's images and checks the answer's model budget on the next read", async () => {
    const asset = { fileId: "img-1", name: "chart.png" };
    images.mockResolvedValue({ assets: [asset], unavailable: [] });
    estimate.mockResolvedValue({
      stats: { total_tokens: 500_000, max_tokens: 128_000 },
    });
    const { apply, session } = reloadedPane({
      identity: "doc-A",
      requestText: "Shorten chapter 3",
      modelId: "model-1",
      fileIds: ["img-1"],
    });
    const answer = await apply(applyInput(), applyContext());
    const token = answer.ok
      ? (answer.result as { snapshot: string }).snapshot
      : "";
    expect(images).not.toHaveBeenCalled();
    await session.execute(
      { snapshot: token },
      applyContext({ toolCallId: "read-B" }),
    );
    expect(images).toHaveBeenCalledWith(["img-1"]);
    expect(session.liveCapture(token)?.authoring?.assets).toEqual([asset]);
    expect(await session.completeReadIssue()).toBe("model-budget");
    expect(estimate.mock.calls.at(-1)?.[0].body).toMatchObject({
      existing_chat_id: "chat-A",
      chat_provider_id: "model-1",
      input_files_ids: ["img-1"],
    });
  });

  it("after a reload allows only scoped reads when the answer names no model", async () => {
    const { apply, session } = reloadedPane({
      identity: "doc-A",
      requestText: "Shorten chapter 3",
    });
    const answer = await apply(applyInput(), applyContext());
    const token = answer.ok
      ? (answer.result as { snapshot: string }).snapshot
      : "";
    await session.execute(
      { snapshot: token },
      applyContext({ toolCallId: "read-B" }),
    );
    expect(await session.completeReadIssue()).toBe("budget-unavailable");
    expect(estimate).not.toHaveBeenCalled();
  });

  it("after a reload finds the request while the approved answer streams again", async () => {
    // As the pane holds them once Allow starts the continuation: the answer is the streaming
    // copy, without its link to the user's message.
    const messages: Record<string, Message> = {
      "user-A": {
        id: "user-A",
        role: "user",
        content: [{ content_type: "text", text: "Shorten chapter 3" }],
        createdAt: "2026-11-23T20:57:09Z",
        action_facet_args: { document_identity: "doc-A" },
      },
      "message-A": {
        id: "message-A",
        role: "assistant",
        content: [],
        createdAt: "2026-11-23T21:05:02Z",
        status: "sending",
      },
    };
    const session = new WordDocumentReadSession();
    const bridge = bridgeFor("doc-A");
    bridge.messageContext = (id) =>
      wordMessageContext(messages, ["user-A", "message-A"], id);
    const apply = createWordApplyPlanExecutor({
      session,
      readEnabled: () => true,
      bridge: () => bridge,
    });
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      ok: true,
      result: {
        status: "stale",
        reason: "capture_lost",
        snapshot: expect.any(String),
      },
    });
  });

  it("answers stale without a copy when reading the document is off", async () => {
    const { apply } = reloadedPane(
      { identity: "doc-A", requestText: "Shorten chapter 3" },
      false,
    );
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "stale", reason: "capture_lost" },
    });
  });

  it("answers stale without a copy when the request is not found", async () => {
    const { apply } = reloadedPane({ identity: "doc-A" });
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "stale", reason: "capture_lost" },
    });
  });

  it("answers unavailable when another document is open", async () => {
    const { apply } = reloadedPane({ identity: "doc-B", requestText: "x" });
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "unavailable", reason: "other_document" },
    });
  });

  it("answers unconfirmed for a write a reload interrupted, and its result once it finished", async () => {
    const { apply } = reloadedPane({ identity: "doc-A", requestText: "x" });
    markWordApplyWriting("submit-A.apply", "doc-A");
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      result: {
        status: "unconfirmed",
        reason: "reloaded_during_write",
        snapshot: expect.any(String),
      },
    });
    markWordApplyDone("other.apply", "doc-A", { status: "applied" });
    expect(
      await apply(applyInput(), applyContext({ toolCallId: "other.apply" })),
    ).toEqual({ ok: true, result: { status: "applied" } });
  });

  it("answers unconfirmed for a write that began before the document is known again", async () => {
    const session = new WordDocumentReadSession();
    const apply = createWordApplyPlanExecutor({
      session,
      readEnabled: () => true,
      bridge: () => bridgeFor(null),
    });
    markWordApplyWriting("submit-A.apply", "doc-A");
    expect(await apply(applyInput(), applyContext())).toEqual({
      ok: true,
      result: { status: "unconfirmed", reason: "reloaded_during_write" },
    });
  });

  it("takes the document a write began on from its marker when the answer names none", async () => {
    const { apply } = reloadedPane({ requestText: "x" });
    markWordApplyWriting("submit-A.apply", "doc-A");
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      result: {
        status: "unconfirmed",
        reason: "reloaded_during_write",
        snapshot: expect.any(String),
      },
    });
  });

  it("answers unconfirmed when pane storage cannot be read", async () => {
    const { apply } = reloadedPane({ identity: "doc-A", requestText: "x" });
    vi.spyOn(globalThis.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await apply(applyInput(), applyContext())).toMatchObject({
      result: { status: "unconfirmed" },
    });
  });
});
