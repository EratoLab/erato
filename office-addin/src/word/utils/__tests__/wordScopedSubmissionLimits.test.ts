import { afterEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
} from "../../../test/mocks/word/authoringFixtures";
import { installWordOoxmlHost } from "../../../test/mocks/word/ooxmlHost";
import {
  captureRealisticSnapshot,
  realisticWordPackageXml,
} from "../../../test/mocks/word/realisticWordFixtures";
import { renderWordDiagnosticReport } from "../wordApplyDiagnostics";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import {
  MAX_WORD_SCOPED_CHANGES,
  MAX_WORD_SCOPED_SOURCES,
  WORD_AUTHORING_CONTRACT,
} from "../wordAuthoringContract";
import { wordDocumentFileToOoxml } from "../wordDocumentPackage";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const context = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "read",
};

async function scopedSubmit(
  snapshot: WordAuthoringSnapshot,
  target: Record<string, unknown>,
  scoped_edit: Record<string, unknown>,
) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = await session.execute(
    { snapshot: snapshot.token, documentIdentity: snapshot.identity, target },
    context,
  );
  if (!read.ok) throw new Error(read.error);
  return createWordDocumentSubmissionExecutor(session)(
    {
      snapshot: snapshot.token,
      readToken: (read.result as { readToken: string }).readToken,
      scoped_edit,
    },
    { ...context, toolCallId: "submit" },
  );
}

const FULL_PLAN_RULE =
  "Use a full plan only to rewrite or reorder most of the document, or when the changes exceed scoped_edit's limits (more than 16 changes per collection, or about 24,000 characters of JSON). Otherwise submit only the changes with scoped_edit, also after a complete read.";

const text = (value: string, id = "new"): WordPlanBlock => ({
  id,
  type: "paragraph",
  text: value,
});
const rejection = (result: Awaited<ReturnType<typeof scopedSubmit>>) => {
  expect(result.ok).toBe(false);
  return (result as { validationErrors?: { message: string }[] })
    .validationErrors?.[0]?.message;
};

/** The production case: a long outline the model had to squeeze to 16 blocks. */
function outline(): WordPlanBlock[] {
  const item = (
    list: string,
    ordered: boolean,
    value: string,
    index: number,
    level = 0,
  ): WordPlanBlock => ({
    id: `${list}-${index}`,
    type: "list-item",
    list,
    level,
    ordered,
    text: value,
  });
  return [
    { id: "rollout-h", type: "heading", level: 2, text: "Rollout plan" },
    ...Array.from({ length: 12 }, (_, i) =>
      item("rollout", true, `Rollout step ${i + 1}`, i),
    ),
    { id: "risks-h", type: "heading", level: 2, text: "Risks" },
    ...Array.from({ length: 12 }, (_, i) =>
      item("risks", false, `Risk ${i + 1}`, i, i % 3 === 2 ? 1 : 0),
    ),
    { id: "owners-h", type: "heading", level: 3, text: "Owners" },
    text("Each region names one owner by Friday.", "owners-p"),
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.WORD_IN_PLACE_APPLY = true;
});

/** One scoped insert-after of `blocks` on the Word PC host, applied and re-read; returns the written
 * blocks after checking their order, type, level and ordered flag. */
async function insertOnWordPc(blocks: WordPlanBlock[]) {
  delete window.WORD_IN_PLACE_APPLY;
  const host = installWordOoxmlHost(realisticWordPackageXml(), {
    profile: "word-pc-16.0.20326",
  });
  const snapshot = await captureRealisticSnapshot();
  const anchorIndex = snapshot.blocks.findIndex(
    (b) => b.text === "Open questions follow.",
  );
  const anchor = snapshot.blocks[anchorIndex];

  const submitted = await scopedSubmit(
    snapshot,
    { ref: anchor.ref },
    { body: [{ operation: "insert-after", anchor: anchor.ref, blocks }] },
  );
  if (!submitted.ok) throw new Error(JSON.stringify(submitted));
  const plan = (submitted.result as { plan: WordDocumentPlan }).plan;
  const inserts = plan.entries.filter((e) => e.kind === "insert");
  expect(inserts).toHaveLength(1);
  expect(inserts[0].blocks).toHaveLength(blocks.length);
  expect(
    plan.entries.flatMap((e) => (e.kind === "keep" ? e.source : [])),
  ).toEqual(snapshot.blocks.map((b) => b.ref));

  const applied = await applyWordDocumentPlan(
    JSON.stringify(plan),
    snapshot,
    "message-A",
  );
  expect(
    applied.status,
    renderWordDiagnosticReport("apply", applied.status, applied.diagnostic),
  ).toBe("applied");

  const after = captureWordAuthoringSnapshot(
    wordDocumentFileToOoxml(host.get()),
    "doc-A",
    "Off",
    true,
  );
  const start =
    after.blocks.findIndex((b) => b.text === "Open questions follow.") + 1;
  const written = after.blocks.slice(start, start + blocks.length);
  expect(
    written.map((b) => ({
      type: b.type,
      text: b.text,
      level: b.level,
      ordered: b.ordered,
    })),
  ).toEqual(
    blocks.map((b) => ({
      type: b.type,
      text: b.text,
      level: b.level,
      ordered: b.type === "list-item" ? b.ordered : undefined,
    })),
  );
  expect(after.blocks[start + blocks.length]?.text).toBe(
    snapshot.blocks[anchorIndex + 1].text,
  );
  const existingLists = snapshot.blocks
    .filter((b) => b.type === "list-item")
    .map((b) => b.list);
  return { written, existingLists };
}

describe("scoped submission limits", { timeout: 30_000 }, () => {
  it("inserts a 28-block outline in one scoped change and applies it on Word PC", async () => {
    const blocks = outline();
    expect(blocks.length).toBeGreaterThanOrEqual(26);
    const { written, existingLists } = await insertOnWordPc(blocks);
    const listOf = (prefix: string) =>
      new Set(
        written
          .filter((b) => b.type === "list-item" && b.text.startsWith(prefix))
          .map((b) => b.list),
      );
    const rollout = listOf("Rollout step");
    const risks = listOf("Risk ");
    expect(rollout.size).toBe(1);
    expect(risks.size).toBe(1);
    expect([...rollout][0]).not.toBe([...risks][0]);
    expect(existingLists).not.toContain([...rollout][0]);
  });

  it("inserts one 26-item ordered list in one scoped change as a single new list", async () => {
    const blocks: WordPlanBlock[] = Array.from({ length: 26 }, (_, i) => ({
      id: `step-${i}`,
      type: "list-item",
      list: "steps",
      level: 0,
      ordered: true,
      text: `Step ${i + 1}`,
    }));
    const { written, existingLists } = await insertOnWordPc(blocks);
    const lists = new Set(written.map((b) => b.list));
    expect(lists.size).toBe(1);
    expect(existingLists).not.toContain([...lists][0]);
  });

  it("names each remaining limit when a scoped submission exceeds it", async () => {
    const fresh = () =>
      readySnapshot(
        packageXml(
          Array.from({ length: 20 }, (_, i) =>
            paragraph(`Paragraph ${i + 1}`),
          ).join(""),
        ),
      );
    const refs = (count: number) =>
      Array.from({ length: count }, (_, i) => `b${i + 1}`);

    const changes = await scopedSubmit(
      fresh(),
      { ref: "b1" },
      {
        body: Array.from({ length: MAX_WORD_SCOPED_CHANGES + 1 }, (_, i) => ({
          operation: "insert-after",
          anchor: "b1",
          blocks: [text(`Added ${i}`, `added-${i}`)],
        })),
      },
    );
    expect(rejection(changes)).toContain(
      `at most ${MAX_WORD_SCOPED_CHANGES} changes`,
    );

    const sources = await scopedSubmit(
      fresh(),
      { ref: "b1", throughRef: "b16" },
      {
        body: [
          {
            operation: "replace",
            source: refs(MAX_WORD_SCOPED_SOURCES + 1),
            blocks: [text("Merged")],
          },
        ],
      },
    );
    expect(rejection(sources)).toContain(
      `at most ${MAX_WORD_SCOPED_SOURCES} source refs`,
    );
    const largest = await scopedSubmit(
      fresh(),
      { ref: "b1", throughRef: "b16" },
      {
        body: [
          {
            operation: "replace",
            source: refs(MAX_WORD_SCOPED_SOURCES),
            blocks: [text("Merged")],
          },
        ],
      },
    );
    expect(largest.ok, JSON.stringify(largest)).toBe(true);

    const oversizedEdit = {
      body: [
        {
          operation: "insert-after",
          anchor: "b1",
          blocks: Array.from({ length: 26 }, (_, i) =>
            text("x".repeat(1000), `long-${i}`),
          ),
        },
      ],
    };
    const oversized = rejection(
      await scopedSubmit(fresh(), { ref: "b1" }, oversizedEdit),
    );
    expect(oversized).toContain(
      "exceeds 24 KiB (about 24,000 characters of JSON)",
    );
    expect(oversized).toContain(FULL_PLAN_RULE);

    const tooLarge = fresh();
    tooLarge.completeReadIssue = "too-large";
    const truncated = rejection(
      await scopedSubmit(tooLarge, { ref: "b1" }, oversizedEdit),
    );
    expect(truncated).toContain(
      "This document is too large for a full plan; submit at most about 24,000 characters of JSON now and tell the user the rest follows in the next turn.",
    );
    expect(truncated).not.toContain("Use a full plan");
  });

  it("tells the model the same limits the checks and the backend schema enforce", () => {
    // The tool description in erato-action-facets.toml carries these exact phrases.
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.input).toContain(
      "at most 16 changes per collection (body, objects, stories, sections), 16 source refs per change and 24 KiB (about 24,000 characters of JSON) per submission",
    );
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.input).toContain(
      "blocks per change have no count limit",
    );
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.input).toContain(FULL_PLAN_RULE);
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.body).toContain(
      "source?:[at most 16 refs]",
    );
  });
});
