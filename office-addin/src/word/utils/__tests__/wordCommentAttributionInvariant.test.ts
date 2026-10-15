import { wordSourceReadRefs } from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  CHAPTER_COMMENTS,
  chapterCommentsBody,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";

import type * as WordReview from "@erato/frontend/word-review";

type WordAuthoringSnapshot = WordReview.WordAuthoringSnapshot;
type WordDocumentPlan = WordReview.WordDocumentPlan;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fault = vi.hoisted(() => ({ rename: false }));

/** Stands for any compile step that would touch a comment the plan keeps. */
vi.mock("@erato/frontend/word-review", async (importOriginal) => {
  const actual = await importOriginal<typeof WordReview>();
  return {
    ...actual,
    compileWordStories: (
      ...args: Parameters<typeof actual.compileWordStories>
    ) => {
      actual.compileWordStories(...args);
      if (fault.rename)
        args[0]
          .getElementsByTagNameNS(W, "comment")[0]
          ?.setAttributeNS(W, "w:author", "Erato");
    },
  };
});

const MESSAGE = "message-A";
const context = { chatId: "chat", messageId: MESSAGE, toolCallId: "read" };

function setup() {
  const snapshot = captureWordAuthoringSnapshot(
    withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS),
    "doc-A",
    "Off",
    true,
  );
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  snapshot.ownerMessageId = MESSAGE;
  const refs = snapshot.blocks.map((b) => b.ref);
  const plan: WordDocumentPlan = {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      { kind: "keep", source: refs.slice(0, 1) },
      {
        kind: "replace",
        source: [refs[1]],
        blocks: [{ id: "n", type: "paragraph", text: "Chapter one, again." }],
      },
      { kind: "keep", source: refs.slice(2) },
    ],
    deleted: [],
  };
  return { snapshot, plan };
}

afterEach(() => {
  fault.rename = false;
  vi.unstubAllGlobals();
});

describe("the comment attribution invariant", () => {
  it("lets a plan compile that leaves every kept comment as written", () => {
    const { snapshot, plan } = setup();
    expect(() => compileWordDocumentPlan(plan, snapshot)).not.toThrow();
  });

  it("fails compilation, the submission and Apply when a kept comment's author would change", async () => {
    const { snapshot, plan } = setup();
    fault.rename = true;
    expect(() => compileWordDocumentPlan(plan, snapshot)).toThrow(
      "comment-attribution-changed",
    );
    const session = new WordDocumentReadSession();
    session.activate(snapshot, context);
    await session.execute({ snapshot: snapshot.token }, context);
    expect(
      await createWordDocumentSubmissionExecutor(session)(
        { ...plan, readToken: snapshot.readToken },
        { ...context, toolCallId: "submit" },
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "comment-attribution-changed" }],
    });
    vi.stubGlobal("Word", { run: vi.fn() });
    const ready: WordAuthoringSnapshot = {
      ...snapshot,
      read: new Set(wordSourceReadRefs(snapshot)),
      readToken: "read-proof",
      ownerMessageId: MESSAGE,
      used: false,
      revoked: false,
    };
    expect(
      await applyWordDocumentPlan(JSON.stringify(plan), ready, MESSAGE),
    ).toMatchObject({
      status: "blocked",
      diagnostic: {
        stage: "compile",
        reason: "compile-failed",
        details: { error: "Error: comment-attribution-changed" },
      },
    });
  });
});
