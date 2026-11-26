import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { WORD_CLIENT_ACTIONS } from "../wordClientActions";
import {
  createWordProposalExecutor,
  wordProposalReviewKey,
} from "../wordProposalApply";

import type { WordClientActionRun } from "../wordClientActions";
import type { WordReviewState } from "../wordReviewState";
import type { WordWriteBridge } from "../wordWriteBridge";
import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

const tracking = vi.hoisted(() => ({ mode: "off" }));
vi.mock("../wordReviewLocation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readWordTrackingMode: () => Promise.resolve(tracking.mode),
}));

const text = (value: string): ContentPart => ({
  content_type: "text",
  text: value,
});
const INSERT = "Here you go:\n\n```erato-word-insert\nA new paragraph.\n```";
const capture = (extra: object = {}): WordDocumentCapture =>
  ({
    identity: "doc-A",
    authoring: readySnapshot(),
    ...extra,
  }) as unknown as WordDocumentCapture;

function host(options: {
  open?: string | null;
  answer?: string;
  latest?: boolean;
  copy?: WordDocumentCapture | null;
  reviews?: Map<string, Partial<WordReviewState>>;
}) {
  const reviews =
    options.reviews ?? new Map<string, Partial<WordReviewState>>();
  const bridge: WordWriteBridge = {
    documentIdentity: () =>
      options.open === undefined ? "doc-A" : options.open,
    updateReview: vi.fn((key: string, patch: Partial<WordReviewState>) => {
      reviews.set(key, { ...reviews.get(key), ...patch });
    }),
    beginOperation: () => true,
    endOperation: vi.fn(),
    holdOperationUntil: vi.fn(),
    setRevertSlot: vi.fn(),
    invalidateLocations: vi.fn(),
    messageContext: () => ({
      identity: "doc-A",
      content: [text(options.answer ?? INSERT)],
      latest: options.latest ?? true,
    }),
    captureFor: () =>
      options.copy === null ? undefined : (options.copy ?? capture()),
    reviewFor: (key) => reviews.get(key) as WordReviewState | undefined,
    locationGeneration: () => 3,
  };
  return { bridge, reviews };
}

const context = { toolCallId: "p1.apply", messageId: "m1", chatId: "c1" };
const input = (
  action: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  proposal_call_id: "p1",
  action,
  item_identity: "doc-A",
  ...extra,
});
const result = (answer: unknown) => (answer as { result: unknown }).result;
const ran = (ok: boolean, extra: Partial<WordClientActionRun> = {}) =>
  Promise.resolve({ ok, outcomes: [], snapshotOoxml: null, ...extra });

const spies: { mockRestore: () => void }[] = [];
function stubExecute(
  action:
    | "word.insert_at_cursor"
    | "word.apply_edits"
    | "word.replace_selection",
  run: () => Promise<WordClientActionRun>,
) {
  const spy = vi
    .spyOn(WORD_CLIENT_ACTIONS.get(action)!, "execute")
    .mockImplementation(run);
  spies.push(spy);
  return spy;
}

beforeEach(() => {
  tracking.mode = "off";
  localStorage.clear();
});
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

describe("insert_at_cursor", () => {
  it("inserts the answer's text and the card in the answer shows it done", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const { bridge, reviews } = host({});
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "applied" },
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ fenceContent: "A new paragraph." }),
    );
    expect(
      reviews.get(
        wordProposalReviewKey(
          "m1",
          "word.insert_at_cursor",
          "A new paragraph.",
        ),
      )?.status,
    ).toBe("done");
    expect(bridge.endOperation).toHaveBeenCalled();
  });

  it("refuses another document than the one the answer was made for", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const { bridge } = host({ open: "doc-B" });
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "unavailable", reason: "other_item" },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses when no document is open", async () => {
    stubExecute("word.insert_at_cursor", () => ran(true));
    const { bridge } = host({ open: null });
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "unavailable", reason: "other_item" },
    );
  });

  it("writes nothing without the copy taken at Send", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const { bridge } = host({ copy: null });
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "unavailable", reason: "capture_lost" },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not insert twice after the user applied it from the card", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const reviews = new Map<string, Partial<WordReviewState>>([
      [
        wordProposalReviewKey(
          "m1",
          "word.insert_at_cursor",
          "A new paragraph.",
        ),
        { status: "done" },
      ],
    ]);
    const { bridge } = host({ reviews });
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "applied", reason: "already_applied" },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not insert again after a click in the answer whose outcome is unknown", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const reviews = new Map<string, Partial<WordReviewState>>([
      [
        wordProposalReviewKey(
          "m1",
          "word.insert_at_cursor",
          "A new paragraph.",
        ),
        { status: "write-failed" },
      ],
    ]);
    const { bridge } = host({ reviews });
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(result(await call(input("word.insert_at_cursor"), context))).toEqual(
      { status: "unconfirmed", reason: "already_attempted" },
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("writes nothing after Stop", async () => {
    const execute = stubExecute("word.insert_at_cursor", () => ran(true));
    const controller = new AbortController();
    controller.abort();
    const { bridge } = host({});
    const call = createWordProposalExecutor("insert_at_cursor", () => bridge);
    expect(
      result(
        await call(input("word.insert_at_cursor"), {
          ...context,
          signal: controller.signal,
        }),
      ),
    ).toEqual({ status: "failed", reason: "stopped" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("acts only for the latest answer and only with its text", async () => {
    stubExecute("word.insert_at_cursor", () => ran(true));
    const older = host({ latest: false }).bridge;
    expect(
      result(
        await createWordProposalExecutor("insert_at_cursor", () => older)(
          input("word.insert_at_cursor"),
          context,
        ),
      ),
    ).toEqual({ status: "unavailable", reason: "not_latest" });
    const prose = host({ answer: "No block here." }).bridge;
    expect(
      result(
        await createWordProposalExecutor("insert_at_cursor", () => prose)(
          input("word.insert_at_cursor"),
          { ...context, toolCallId: "p2.apply" },
        ),
      ),
    ).toEqual({ status: "failed", reason: "not_found" });
  });
});

describe("apply_edits", () => {
  const EDITS =
    '```erato-word-edits\n{"edits":[{"paragraph":1,"text":"New"}]}\n```';

  it("writes nothing under Track Changes", async () => {
    const execute = stubExecute("word.apply_edits", () => ran(true));
    tracking.mode = "on";
    const { bridge } = host({ answer: EDITS });
    const call = createWordProposalExecutor("apply_edits", () => bridge);
    expect(result(await call(input("word.apply_edits"), context))).toEqual({
      status: "failed",
      reason: "track_changes",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(bridge.endOperation).toHaveBeenCalled();
  });

  it("applies the edits and keeps the guarded revert", async () => {
    stubExecute("word.apply_edits", () =>
      ran(true, { snapshotOoxml: "<before/>", afterFingerprint: "f" }),
    );
    const { bridge } = host({ answer: EDITS });
    const call = createWordProposalExecutor("apply_edits", () => bridge);
    expect(result(await call(input("word.apply_edits"), context))).toEqual({
      status: "applied",
    });
    expect(bridge.setRevertSlot).toHaveBeenCalledWith(
      expect.objectContaining({ ooxml: "<before/>", afterFingerprint: "f" }),
    );
    expect(bridge.updateReview).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: "done", locationGeneration: 3 }),
    );
  });

  it("refuses another document", async () => {
    stubExecute("word.apply_edits", () => ran(true));
    const { bridge } = host({ answer: EDITS, open: "doc-B" });
    const call = createWordProposalExecutor("apply_edits", () => bridge);
    expect(result(await call(input("word.apply_edits"), context))).toEqual({
      status: "unavailable",
      reason: "other_item",
    });
  });
});

describe("replace_selection", () => {
  const REPLACE = "```erato-word-replace\nBetter words.\n```";
  const replaced = () =>
    ran(true, {
      selectionResult: {
        status: "applied",
        written: {} as never,
        backups: null,
        trackingOn: false,
        settled: Promise.resolve(),
      },
    });

  it("replaces the passage captured at Send", async () => {
    stubExecute("word.replace_selection", replaced);
    const { bridge } = host({ answer: REPLACE });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "applied" });
  });

  it("asks on screen first when the request carried comment text", async () => {
    const execute = stubExecute("word.replace_selection", replaced);
    const { bridge } = host({
      answer: REPLACE,
      copy: capture({ commentTaint: true }),
    });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "needs_decision", reason: "comment_text" });
    expect(execute).not.toHaveBeenCalled();
    expect(
      result(
        await call(
          input("word.replace_selection", {
            confirmation: { confirmed: true },
          }),
          context,
        ),
      ),
    ).toEqual({ status: "applied" });
  });

  it("leaves several versions to the user's pick", async () => {
    const execute = stubExecute("word.replace_selection", replaced);
    const { bridge } = host({
      answer: `${REPLACE}\n\n\`\`\`erato-word-replace\nOther words.\n\`\`\``,
    });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "unavailable", reason: "user_picks" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("answers applied when the user already replaced with one of the versions", async () => {
    const execute = stubExecute("word.replace_selection", replaced);
    const reviews = new Map<string, Partial<WordReviewState>>([
      [
        wordProposalReviewKey("m1", "word.replace_selection", "Other words."),
        { status: "done" },
      ],
    ]);
    const { bridge } = host({
      answer: `${REPLACE}\n\n\`\`\`erato-word-replace\nOther words.\n\`\`\``,
      reviews,
    });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "applied", reason: "already_applied" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("says a write that may have landed is unconfirmed", async () => {
    stubExecute("word.replace_selection", () =>
      ran(false, {
        selectionResult: {
          status: "unverified",
          timedOut: true,
          settled: Promise.resolve(),
        } as never,
      }),
    );
    const { bridge } = host({ answer: REPLACE });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "unconfirmed", reason: "unverified" });
  });

  it("refuses another document", async () => {
    stubExecute("word.replace_selection", replaced);
    const { bridge } = host({ answer: REPLACE, open: "doc-B" });
    const call = createWordProposalExecutor("replace_selection", () => bridge);
    expect(
      result(await call(input("word.replace_selection"), context)),
    ).toEqual({ status: "unavailable", reason: "other_item" });
  });
});
