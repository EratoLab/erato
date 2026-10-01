import {
  buildWordPlanReview,
  wordSnapshotFromHistory,
  wordSourceReadRefs,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  examplePlan,
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { storedWordReads } from "../../../test/mocks/word/historyReads";
import {
  mixedAuthoringXml,
  nativeTable,
} from "../../../test/mocks/word/mixedAuthoringFixtures";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import { wordReadableSourceBlock } from "../wordAuthoringReadData";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import { resolveWordWriteGate } from "../wordWriteGate";

import type { ContentPart } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text)}</w:p>`;

/** The source as the model read it: the reader's projection without host XML. */
function expectedSource(snapshot: WordAuthoringSnapshot) {
  return {
    blocks: json(
      snapshot.blocks.map((b) => ({ ...wordReadableSourceBlock(b), xml: "" })),
    ),
    stories: snapshot.stories?.map(
      ({ xml: _xml, part: _part, nativeId: _nativeId, ...story }) =>
        json({ ...story, xml: "", part: "" }),
    ),
    sections: snapshot.sections?.map((section) =>
      json({ ...section, xml: "" }),
    ),
  };
}

async function rebuild(snapshot: WordAuthoringSnapshot) {
  const reads = await storedWordReads(snapshot);
  return {
    reads,
    rebuilt: wordSnapshotFromHistory([{ content: reads }], snapshot.token),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Word snapshot rebuilt from stored reads", () => {
  it("rejoins multi-part text, its run slices and structure chunks of a body read", async () => {
    const long = "Evidence ".repeat(700);
    const snapshot = captureWordAuthoringSnapshot(
      packageXml(
        heading("Findings") +
          `<w:p>${run(long, "<w:b/>")}${run(long)}${run("Tail.", "<w:i/>")}</w:p>` +
          paragraph("Plain paragraph") +
          nativeTable,
      ),
      "doc-A",
      "Off",
    );
    expect(snapshot.issue).toBeUndefined();
    const { reads, rebuilt } = await rebuild(snapshot);
    const fragments = reads.flatMap(
      (part) =>
        (
          (part as Extract<ContentPart, { content_type: "tool_use" }>)
            .output as unknown as {
            result: { blocks: { ref: string; part: number }[] };
          }
        ).result.blocks,
    );
    expect(fragments.filter((f) => f.ref === "b2").length).toBeGreaterThan(1);
    expect(fragments.some((f) => "structureJson" in f)).toBe(true);
    expect(rebuilt).toBeDefined();
    const expected = expectedSource(snapshot);
    expect(rebuilt!.blocks).toEqual(expected.blocks);
    expect(rebuilt!.blocks[1].runs).toEqual(snapshot.blocks[1].runs);
    expect(rebuilt!.blocks[3].content).toEqual(
      json(snapshot.blocks[3].content),
    );
    expect(rebuilt!.styles).toEqual(json(snapshot.styles));
    expect(rebuilt).toMatchObject({
      source: "history",
      token: snapshot.token,
      readToken: snapshot.readToken,
      revoked: true,
      used: true,
      ooxml: "",
    });
    expect(rebuilt!.fullDocument).toBeUndefined();
    expect([...rebuilt!.read]).toEqual(wordSourceReadRefs(snapshot));
  });

  it("restores stories, sections, assets and preserved parts of a whole-document read", async () => {
    const snapshot = captureWordAuthoringSnapshot(
      mixedAuthoringXml(),
      "doc-A",
      "Off",
      true,
    );
    expect(snapshot.issue).toBeUndefined();
    expect(snapshot.stories?.length).toBeGreaterThan(0);
    expect(snapshot.sections?.length).toBeGreaterThan(0);
    const { rebuilt } = await rebuild(snapshot);
    const expected = expectedSource(snapshot);
    expect(rebuilt).toBeDefined();
    expect(rebuilt!.fullDocument).toBe(true);
    expect(rebuilt!.blocks).toEqual(expected.blocks);
    expect(rebuilt!.stories).toEqual(expected.stories);
    expect(rebuilt!.sections).toEqual(expected.sections);
    expect(rebuilt!.preservedStories).toEqual(snapshot.preservedStories ?? []);
    expect(rebuilt!.assets).toEqual([]);
    expect([...rebuilt!.read]).toEqual(wordSourceReadRefs(snapshot));
  });

  it("reviews a plan against the rebuilt source as against the capture", async () => {
    const snapshot = readySnapshot();
    const plan = examplePlan(snapshot.token);
    const live = buildWordPlanReview(plan, snapshot);
    const { rebuilt } = await rebuild(snapshot);
    const history = buildWordPlanReview(plan, rebuilt);
    expect(history.title).toEqual(live.title);
    expect(history.risks).toEqual(live.risks);
    expect(history.riskUnknown).toBe(false);
    expect(buildWordPlanReview(plan, undefined).riskUnknown).toBe(true);
  });

  it("gives up on incomplete, broken or foreign reads", async () => {
    const snapshot = captureWordAuthoringSnapshot(
      packageXml(paragraph("Long content. ".repeat(4000))),
      "doc-A",
      "Off",
    );
    const reads = await storedWordReads(snapshot);
    expect(reads.length).toBeGreaterThan(2);
    const find = (content: ContentPart[], id = snapshot.token) =>
      wordSnapshotFromHistory([{ content }], id);
    expect(find(reads)).toBeDefined();
    expect(find(reads.slice(0, -1))).toBeUndefined();
    expect(find([reads[0], ...reads.slice(2)])).toBeUndefined();
    expect(find(reads.slice(1))).toBeUndefined();
    expect(find(reads, "another-snapshot")).toBeUndefined();
    const broken = json(reads);
    const page = broken[1] as Extract<
      ContentPart,
      { content_type: "tool_use" }
    >;
    (
      page.output as unknown as { result: { blocks: unknown[] } }
    ).result.blocks.pop();
    expect(find(broken)).toBeUndefined();
  });
});

describe("history snapshots never write", () => {
  async function historySnapshot() {
    const snapshot = readySnapshot();
    const { rebuilt } = await rebuild(snapshot);
    rebuilt!.ownerMessageId = "message-A";
    rebuilt!.revoked = false;
    rebuilt!.used = false;
    return { snapshot, rebuilt: rebuilt! };
  }

  it("is refused by the apply pipeline before Word is touched", async () => {
    const { snapshot, rebuilt } = await historySnapshot();
    const word = vi.fn();
    vi.stubGlobal("Word", { run: word });
    const result = await applyWordDocumentPlan(
      JSON.stringify(examplePlan(snapshot.token)),
      rebuilt,
      "message-A",
    );
    expect(result).toMatchObject({
      status: "blocked",
      diagnostic: { stage: "validate", reason: "no-capture" },
    });
    expect(word).not.toHaveBeenCalled();
  });

  it("is refused by the write gate and the read session", async () => {
    const { rebuilt } = await historySnapshot();
    expect(
      resolveWordWriteGate({
        capture: {
          identity: "doc-A",
          authoring: rebuilt,
          ordinalMap: new Map(),
          paragraphsSent: 0,
          renderedOrdinals: new Set(),
          partialOrdinal: null,
        },
        expectedIdentity: "doc-A",
        currentIdentity: "doc-A",
      }),
    ).toEqual({ allowed: false, reason: "no-capture" });
    const session = new WordDocumentReadSession();
    const context = { toolCallId: "read", messageId: "m", chatId: "c" };
    session.activate(rebuilt, context);
    expect(session.snapshotForSubmission(context)).toBeUndefined();
    expect(
      await session.execute({ snapshot: rebuilt.token }, context),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "read-unavailable" }],
    });
  });
});
