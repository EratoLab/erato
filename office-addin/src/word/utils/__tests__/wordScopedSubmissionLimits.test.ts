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

describe("scoped submission limits", { timeout: 30_000 }, () => {
  it("inserts a 28-block outline in one scoped change and applies it on Word PC", async () => {
    delete window.WORD_IN_PLACE_APPLY;
    const host = installWordOoxmlHost(realisticWordPackageXml(), {
      profile: "word-pc-16.0.20326",
    });
    const snapshot = await captureRealisticSnapshot();
    const anchorIndex = snapshot.blocks.findIndex(
      (b) => b.text === "Open questions follow.",
    );
    const anchor = snapshot.blocks[anchorIndex];
    const blocks = outline();
    expect(blocks.length).toBeGreaterThanOrEqual(26);

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
    const existing = snapshot.blocks
      .filter((b) => b.type === "list-item")
      .map((b) => b.list);
    expect(existing).not.toContain([...rollout][0]);
    expect(after.blocks[start + blocks.length]?.text).toBe(
      snapshot.blocks[anchorIndex + 1].text,
    );
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

    const oversized = await scopedSubmit(
      fresh(),
      { ref: "b1" },
      {
        body: [
          {
            operation: "insert-after",
            anchor: "b1",
            blocks: Array.from({ length: 26 }, (_, i) =>
              text("x".repeat(1000), `long-${i}`),
            ),
          },
        ],
      },
    );
    const message = rejection(oversized);
    expect(message).toContain("exceeds 24 KiB");
    expect(message).toContain("full plan");
  });

  it("tells the model the same limits the checks and the backend schema enforce", () => {
    // The tool description in erato-action-facets.toml carries this exact phrase.
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.input).toContain(
      "at most 16 changes per collection, 16 source refs per change and 24 KiB per submission",
    );
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.input).toContain(
      "blocks per change have no count limit",
    );
    expect(WORD_AUTHORING_CONTRACT.scopedEdit.body).toContain(
      "source?:[at most 16 refs]",
    );
  });
});
