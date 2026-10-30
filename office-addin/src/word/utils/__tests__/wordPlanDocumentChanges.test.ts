import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { okResult } from "../../../test/mocks/word/sectionFixtures";
import { escapeXml } from "../../../utils/escapeXml";
import {
  beginWordOwnWrite,
  nameWordOwnWriteIds,
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
} from "../wordChangeJournal";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import { wordPlanWrittenBlocks } from "../wordPlanDocumentChanges";

import type { WordDocumentBuild } from "../buildWordDocumentArgs";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const context = { chatId: "chat-A", messageId: "message-A", toolCallId: "c" };

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc><w:tcPr/>${paragraph(text)}</w:tc>`;
const TABLE = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell("Service")}${cell("Level")}</w:tr><w:tr>${cell("Hosting")}${cell("99.5 %")}</w:tr></w:tbl>`;

/** Three numbered chapters; § 2 holds a table. */
function captured() {
  const snapshot = captureWordAuthoringSnapshot(
    packageXml(
      [
        heading("§ 1 Gegenstand"),
        paragraph("The Supplier provides the services."),
        heading("§ 2 Leistungen"),
        paragraph("Service levels are listed below."),
        TABLE,
        paragraph("Levels are measured monthly."),
        heading("§ 3 Haftung"),
        paragraph("Liability is limited to the annual fee."),
        paragraph("Neither party is liable for indirect loss."),
      ].join(""),
    ),
    "doc-A",
    "Off",
  );
  const ordinalMap: WordDocumentBuild["ordinalMap"] = new Map();
  const ids = new Map<string, string[]>();
  let ordinal = 0;
  for (const block of snapshot.blocks) {
    const texts =
      block.type === "native"
        ? block.content!.rows.flatMap((row) => row.cells.map((c) => c.text))
        : [block.text];
    ids.set(
      block.ref,
      texts.map((text) => {
        ordinal += 1;
        const id = `p${ordinal}`;
        ordinalMap.set(ordinal, { uniqueLocalId: id, text });
        return id;
      }),
    );
    if (block.type !== "native") block.paragraphOrdinal = ordinal;
  }
  noteWordCapturedIds([...ordinalMap.values()].map((p) => p.uniqueLocalId));
  const capture = {
    changes: {
      position: wordChangePosition(),
      capturedAt: "2026-10-30T09:00:00.000Z",
    },
    ordinalMap,
  };
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context, undefined, { capture });
  return { snapshot, session, ids };
}

const refOf = (snapshot: WordAuthoringSnapshot, text: string) =>
  snapshot.blocks.find((b) => b.text === text)!.ref;

const changed = (ids: string[], source = "Local") =>
  recordWordParagraphEvent({
    type: "ParagraphChanged",
    source,
    uniqueLocalIds: ids,
  });

let doc: ReturnType<typeof captured>;
let submit: ReturnType<typeof createWordDocumentSubmissionExecutor>;
let call = 0;

async function read(input: Record<string, unknown>) {
  return okResult<{ readToken: string; target?: Record<string, unknown> }>(
    await doc.session.execute(
      {
        snapshot: doc.snapshot.token,
        documentIdentity: doc.snapshot.identity,
        ...input,
      },
      { ...context, toolCallId: `read-${++call}` },
    ),
  );
}

async function scopedEdit(text: string, operation = "replace") {
  const ref = refOf(doc.snapshot, text);
  const { readToken } = await read({ target: { ref } });
  return submit(
    {
      snapshot: doc.snapshot.token,
      readToken,
      scoped_edit: {
        body: [
          operation === "replace"
            ? {
                operation,
                source: [ref],
                blocks: [{ id: "n1", type: "paragraph", text: "Rewritten." }],
              }
            : {
                operation,
                anchor: ref,
                blocks: [{ id: "n1", type: "paragraph", text: "Added." }],
              },
        ],
      },
    },
    { ...context, toolCallId: `submit-${++call}` },
  );
}

async function cellEdit() {
  const { readToken, target } = await read({ table_cell: { text: "99.5" } });
  return submit(
    {
      snapshot: doc.snapshot.token,
      readToken,
      table_cell: { ...target, text: "99.9 %" },
    },
    { ...context, toolCallId: `submit-${++call}` },
  );
}

async function fullPlan() {
  const { readToken } = okResult<{ readToken: string }>(
    await doc.session.execute(
      { snapshot: doc.snapshot.token, cursor: null },
      { ...context, toolCallId: `read-${++call}` },
    ),
  );
  const replaced = refOf(doc.snapshot, "The Supplier provides the services.");
  return submit(
    {
      version: 1,
      snapshot: doc.snapshot.token,
      readToken,
      scope: "body",
      entries: doc.snapshot.blocks.map((b) =>
        b.ref === replaced
          ? {
              kind: "replace",
              source: [b.ref],
              blocks: [{ id: "n1", type: "paragraph", text: "Rewritten." }],
            }
          : { kind: "keep", source: [b.ref] },
      ),
      deleted: [],
    },
    { ...context, toolCallId: `submit-${++call}` },
  );
}

function refusal(result: ClientToolExecutionResult) {
  expect(result).toMatchObject({
    ok: false,
    validationErrors: [{ code: "document-changed" }],
    submissionFeedback: { terminal: true, recovery: "cannot_continue" },
  });
  if (result.ok) throw new Error("accepted");
  return result.validationErrors![0].message;
}

const idsOf = (text: string) => doc.ids.get(refOf(doc.snapshot, text))!;

describe("a plan that writes what changed since the capture", () => {
  beforeEach(() => {
    resetWordChangeJournalForTests();
    noteWordChangeEventsActive();
    doc = captured();
    submit = createWordDocumentSubmissionExecutor(doc.session);
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallMockWordDocument();
  });

  it("is refused when the user edited a paragraph it writes, naming the part by its title", async () => {
    changed(idsOf("Liability is limited to the annual fee."));

    const message = refusal(
      await scopedEdit("Liability is limited to the annual fee."),
    );

    expect(message).toContain('The user changed "§ 3 Haftung" in Word');
    expect(message).toContain("can run the request again");
    expect(message).toContain("Do not propose another plan.");
    expect(message).not.toMatch(/\bb\d+\b/);
  });

  it("is staged when the edit lies elsewhere in the same chapter", async () => {
    changed(idsOf("Neither party is liable for indirect loss."));

    expect(
      (await scopedEdit("Liability is limited to the annual fee.")).ok,
    ).toBe(true);
  });

  it("is refused when an insertion's anchor changed, and names a co-author's change as theirs", async () => {
    changed(idsOf("Liability is limited to the annual fee."), "Remote");

    expect(
      refusal(
        await scopedEdit(
          "Liability is limited to the annual fee.",
          "insert-after",
        ),
      ),
    ).toContain('A co-author changed "§ 3 Haftung"');
  });

  it("is refused when the user added a paragraph next to one it writes", async () => {
    vi.useFakeTimers();
    const anchor = idsOf("Liability is limited to the annual fee.")[0];
    installMockWordDocument(
      [...doc.ids.values()]
        .flat()
        .flatMap((id) => (id === anchor ? [id, "new-1"] : [id]))
        .map((id) => ({ text: id, uniqueLocalId: id })),
    );
    recordWordParagraphEvent({
      type: "ParagraphAdded",
      source: "Local",
      uniqueLocalIds: ["new-1"],
    });
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();

    refusal(await scopedEdit("Liability is limited to the annual fee."));
  });

  it("is staged after the pane's own write to that paragraph", async () => {
    const written = idsOf("Liability is limited to the annual fee.");
    const write = beginWordOwnWrite("ids");
    nameWordOwnWriteIds(written);
    changed(written);
    write.end();

    expect(
      (await scopedEdit("Liability is limited to the annual fee.")).ok,
    ).toBe(true);
  });

  it("is staged after an unknown change, which Apply's live check guards", async () => {
    recordWordParagraphEvent({
      type: "ParagraphDeleted",
      source: "Local",
      uniqueLocalIds: [...doc.ids.values()].flat(),
    });

    expect(
      (await scopedEdit("Liability is limited to the annual fee.")).ok,
    ).toBe(true);
  });

  it("refuses a table_cell edit by its table's part, not for an edit beside the table", async () => {
    changed(idsOf("Service levels are listed below."));
    expect((await cellEdit()).ok).toBe(true);

    doc = captured();
    submit = createWordDocumentSubmissionExecutor(doc.session);
    const table = doc.snapshot.blocks.find((b) => b.type === "native")!;
    changed([doc.ids.get(table.ref)![1]]);

    expect(refusal(await cellEdit())).toContain('"§ 2 Leistungen"');
  });

  it("counts a moved paragraph as written, not the ones it passes", () => {
    const refs = doc.snapshot.blocks.map((b) => b.ref);
    const moved = refOf(
      doc.snapshot,
      "Liability is limited to the annual fee.",
    );
    const order = [refs[0], moved, ...refs.slice(1).filter((r) => r !== moved)];

    expect([
      ...wordPlanWrittenBlocks(
        {
          version: 1,
          snapshot: doc.snapshot.token,
          readToken: "scoped",
          scope: "body",
          entries: order.map((ref) => ({ kind: "keep", source: [ref] })),
          deleted: [],
        },
        doc.snapshot,
      ),
    ]).toEqual([refs.indexOf(moved)]);
  });

  it("refuses a whole-document plan for a change anywhere, and stages it otherwise", async () => {
    expect((await fullPlan()).ok).toBe(true);

    doc = captured();
    submit = createWordDocumentSubmissionExecutor(doc.session);
    changed(idsOf("Neither party is liable for indirect loss."));

    expect(refusal(await fullPlan())).toContain('"§ 3 Haftung"');
  });
});
