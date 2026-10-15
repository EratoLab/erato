import { wordPlanCommentThreads } from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import { packageXml } from "../../../test/mocks/word/authoringFixtures";
import {
  CHAPTER_COMMENTS,
  FIXTURE_ME,
  chapterCommentsBody,
  withComments,
} from "../../../test/mocks/word/commentFixtures";
import { ooxmlHostCommentStates } from "../../../test/mocks/word/commentStates";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import { captureRealisticSnapshot } from "../../../test/mocks/word/realisticWordFixtures";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import {
  captureWordDocumentPackage,
  insertWordDocumentFile,
} from "../wordDocumentPackage";
import { parseWordXml } from "../wordDocumentPackageCodec";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { wordInPlaceCapabilities } from "../wordInPlaceCapabilities";
import { routeWordDocumentPlan } from "../wordInPlaceRoute";
import { wordInPlaceAvailability } from "../wordInPlaceSwitch";
import { readWordCommentStates } from "../wordPlanCommentCheck";
import { wordPlanCommentConsequences } from "../wordPlanComments";

import type * as wordDocumentPackageModule from "../wordDocumentPackage";
import type * as wordPlanCommentCheckModule from "../wordPlanCommentCheck";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

vi.mock("../wordPlanCommentCheck", async (importOriginal) => {
  const { ooxmlHostCommentStates } = await import(
    "../../../test/mocks/word/commentStates"
  );
  return {
    ...(await importOriginal<typeof wordPlanCommentCheckModule>()),
    readWordCommentStates: vi.fn(ooxmlHostCommentStates),
  };
});

vi.mock("../wordDocumentPackage", async (importOriginal) => {
  const actual = await importOriginal<typeof wordDocumentPackageModule>();
  return {
    ...actual,
    insertWordDocumentFile: vi.fn(actual.insertWordDocumentFile),
  };
});

const MESSAGE = "message-A";
const chapters = () =>
  withComments(packageXml(chapterCommentsBody()), CHAPTER_COMMENTS);

async function open() {
  const host = installWordOoxmlHost(chapters(), {
    profile: "word-pc-16.0.20326",
  });
  const snapshot = await captureRealisticSnapshot(MESSAGE);
  return { host, snapshot };
}

function keepAllBut(
  snapshot: WordAuthoringSnapshot,
  refs: string[],
  text: string,
): WordDocumentPlan {
  const all = snapshot.blocks.map((b) => b.ref);
  const at = all.indexOf(refs[0]);
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries: [
      { kind: "keep", source: all.slice(0, at) },
      {
        kind: "replace",
        source: refs,
        blocks: [{ id: "new", type: "paragraph", text }],
      },
      { kind: "keep", source: all.slice(at + refs.length) },
    ],
    deleted: [],
  };
}

function consequences(snapshot: WordAuthoringSnapshot, plan: WordDocumentPlan) {
  const xml = compileWordDocumentPlan(plan, snapshot);
  const prepared = captureWordAuthoringSnapshot(
    xml,
    snapshot.identity,
    "Off",
    true,
    "verify",
  );
  return {
    route: routeWordDocumentPlan(
      plan,
      snapshot,
      wordInPlaceAvailability(),
      wordInPlaceCapabilities(),
      prepared,
    ).route,
    ...wordPlanCommentConsequences(snapshot, xml, prepared),
  };
}

const liveThreads = async () =>
  wordPlanCommentThreads(
    parseWordXml((await captureWordDocumentPackage()).ooxml),
  );

afterEach(() => {
  vi.mocked(insertWordDocumentFile).mockClear();
  vi.mocked(readWordCommentStates).mockClear();
  vi.unstubAllGlobals();
});
const UNCHANGED = { removed: 0, kept: 0, unexpected: 0 };

describe("comment threads a plan removes, on every apply route", () => {
  it("in place: an edit beside the comments removes none and needs no tick", async () => {
    const { snapshot } = await open();
    const plan = keepAllBut(snapshot, ["b2"], "Chapter one, revised.");
    const found = consequences(snapshot, plan);
    expect(found.route).toBe("in-place");
    expect(found.removals).toEqual([]);
    const result = await applyWordDocumentPlan(
      JSON.stringify(plan),
      snapshot,
      MESSAGE,
    );
    expect(result).toMatchObject({
      status: "applied",
      outcome: { route: "in-place", comments: UNCHANGED },
    });
    expect((await liveThreads()).map((t) => t.wId)).toEqual(["0", "3", "5"]);
    expect(readWordCommentStates).toHaveBeenCalledTimes(2);
  });

  it("import: shortening chapter 3 names its two threads and writes nothing until they are ticked", async () => {
    const { snapshot } = await open();
    const plan = keepAllBut(
      snapshot,
      ["b6", "b7", "b8", "b9"],
      "Chapter three, in short.",
    );
    const found = consequences(snapshot, plan);
    expect(found.route).toBe("import");
    expect(
      found.removals.map(({ thread }) => [thread.author, thread.resolved]),
    ).toEqual([
      ["Lee Chen", true],
      [FIXTURE_ME, false],
    ]);
    const before = (await captureWordDocumentPackage()).fingerprint;
    for (const commentRemovalsConfirmed of [undefined, "word-body-v2:other"])
      expect(
        await applyWordDocumentPlan(
          JSON.stringify(plan),
          snapshot,
          MESSAGE,
          undefined,
          undefined,
          { commentRemovalsConfirmed },
        ),
      ).toMatchObject({
        status: "blocked",
        diagnostic: {
          stage: "validate",
          reason: "comment-removals-need-confirmation",
          details: { commentThreads: 2 },
        },
      });
    expect(insertWordDocumentFile).not.toHaveBeenCalled();
    expect(snapshot.used).toBe(false);
    expect((await captureWordDocumentPackage()).fingerprint).toBe(before);

    const result = await applyWordDocumentPlan(
      JSON.stringify(plan),
      snapshot,
      MESSAGE,
      undefined,
      undefined,
      { commentRemovalsConfirmed: found.fingerprint },
    );
    expect(result).toMatchObject({
      status: "applied",
      outcome: {
        route: "import",
        comments: { removed: 2, kept: 0, unexpected: 0 },
      },
    });
    const left = await liveThreads();
    expect(left.map((t) => [t.wId, t.replies.length])).toEqual([["0", 2]]);
  });

  it("scoped edit: replacing one commented paragraph names its thread and needs the tick", async () => {
    const { snapshot } = await open();
    const session = new WordDocumentReadSession();
    const context = { chatId: "chat", messageId: MESSAGE, toolCallId: "read" };
    session.activate(snapshot, context);
    const read = await session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        target: { ref: "b8" },
      },
      context,
    );
    if (!read.ok) throw new Error(read.error);
    const submitted = await createWordDocumentSubmissionExecutor(session)(
      {
        snapshot: snapshot.token,
        readToken: (read.result as { readToken: string }).readToken,
        scoped_edit: {
          body: [
            {
              operation: "replace",
              source: ["b8"],
              blocks: [
                { id: "n", type: "paragraph", text: "We plan one pilot." },
              ],
            },
          ],
        },
      },
      { ...context, toolCallId: "edit" },
    );
    expect(submitted.ok).toBe(true);
    const plan = (submitted as { result: { plan: WordDocumentPlan } }).result
      .plan;
    const found = consequences(snapshot, plan);
    expect(found.removals.map(({ thread }) => thread.author)).toEqual([
      FIXTURE_ME,
    ]);
    expect(
      await applyWordDocumentPlan(JSON.stringify(plan), snapshot, MESSAGE),
    ).toMatchObject({
      status: "blocked",
      diagnostic: { reason: "comment-removals-need-confirmation" },
    });
    expect(insertWordDocumentFile).not.toHaveBeenCalled();
    expect(
      await applyWordDocumentPlan(
        JSON.stringify(plan),
        snapshot,
        MESSAGE,
        undefined,
        undefined,
        { commentRemovalsConfirmed: found.fingerprint },
      ),
    ).toMatchObject({
      status: "applied",
      outcome: { comments: { removed: 1, kept: 0, unexpected: 0 } },
    });
    expect((await liveThreads()).map((t) => t.wId)).toEqual(["0", "3"]);
  });
});

describe("the comment check after every written apply", () => {
  const shorten = (snapshot: WordAuthoringSnapshot) =>
    keepAllBut(snapshot, ["b6", "b7", "b8", "b9"], "Chapter three, in short.");
  const confirmed = (snapshot: WordAuthoringSnapshot) => ({
    commentRemovalsConfirmed: consequences(snapshot, shorten(snapshot))
      .fingerprint,
  });

  it("reports a thread Word changed beyond the plan", async () => {
    const { snapshot } = await open();
    vi.mocked(readWordCommentStates)
      .mockImplementationOnce(ooxmlHostCommentStates)
      .mockImplementationOnce(async () =>
        (await ooxmlHostCommentStates())!.filter(
          (t) => t.id !== String(0x6d5c0001),
        ),
      );
    expect(
      await applyWordDocumentPlan(
        JSON.stringify(shorten(snapshot)),
        snapshot,
        MESSAGE,
        undefined,
        undefined,
        confirmed(snapshot),
      ),
    ).toMatchObject({
      status: "applied",
      outcome: { comments: { removed: 2, kept: 0, unexpected: 1 } },
    });
  });

  it("says so when Word could not list the comments, and never reads for an unwritten apply", async () => {
    const { snapshot } = await open();
    vi.mocked(readWordCommentStates).mockResolvedValueOnce(null);
    expect(
      await applyWordDocumentPlan(
        JSON.stringify(shorten(snapshot)),
        snapshot,
        MESSAGE,
        undefined,
        undefined,
        confirmed(snapshot),
      ),
    ).toMatchObject({
      status: "applied",
      outcome: { comments: { unverified: true } },
    });
    vi.mocked(readWordCommentStates).mockClear();
    const again = await open();
    await applyWordDocumentPlan(
      JSON.stringify(shorten(again.snapshot)),
      again.snapshot,
      MESSAGE,
    );
    expect(readWordCommentStates).not.toHaveBeenCalled();
  });

  it("checks a write that stopped partway too", async () => {
    const { host, snapshot } = await open();
    host.failAfterWrite();
    const result = await applyWordDocumentPlan(
      JSON.stringify(shorten(snapshot)),
      snapshot,
      MESSAGE,
      undefined,
      undefined,
      confirmed(snapshot),
    );
    expect(result).toMatchObject({
      status: "interrupted",
      diagnostic: {
        details: { comments: { removed: 2, kept: 0, unexpected: 0 } },
      },
    });
  });
});
