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

import type { WordDocumentApplyResult } from "../wordApplyDocumentPlan";
import type { WordClientActionRun } from "../wordClientActions";
import type * as WordPlanApplyModule from "../wordPlanApply";
import type { WordWriteBridge } from "../wordWriteBridge";
import type { ClientToolCallContext } from "@erato/frontend/library";

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
  submission_call_id: "submit-A",
  draft_id: "submit-A",
  confirmation,
});

function bridgeFor(
  identity: string | null,
  stored: { identity?: string; requestText?: string } = {},
): WordWriteBridge {
  let busy = false;
  return {
    documentIdentity: () => identity,
    updateReview: vi.fn(),
    beginOperation: () => (busy ? false : (busy = true)),
    endOperation: () => {
      busy = false;
    },
    setRevertSlot: vi.fn(),
    invalidateLocations: vi.fn(),
    messageContext: () => stored,
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
  routing.override = undefined;
  routing.coauthors = false;
  coauthoring.state = undefined;
  localStorage.clear();
  forgetWordAcceptedPlansForTests();
});
afterEach(() => vi.restoreAllMocks());

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

    const later = new AbortController();
    execute.mockImplementation(async ({ onBeforeDocumentWrite }) => {
      onBeforeDocumentWrite?.("<before/>");
      later.abort();
      return applied();
    });
    expect(
      await apply(
        applyInput(),
        applyContext({ toolCallId: "submit-A.apply-2", signal: later.signal }),
      ),
    ).toMatchObject({ result: { status: "applied" } });
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

describe("an apply without its copy", () => {
  const reloadedPane = (
    stored: { identity?: string; requestText?: string },
    readEnabled = true,
  ) => {
    const session = new WordDocumentReadSession();
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
