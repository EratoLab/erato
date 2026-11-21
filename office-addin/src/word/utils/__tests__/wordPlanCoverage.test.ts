import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { escapeXml } from "../../../utils/escapeXml";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import {
  wordNotInProposalReceipt,
  wordPartsNotInProposal,
  wordSubmissionBlocks,
} from "../wordPlanCoverage";

import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const context = { chatId: "chat-A", messageId: "message-A", toolCallId: "c" };

const heading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

function contract() {
  return captureWordAuthoringSnapshot(
    packageXml(
      [
        paragraph("This contract is made between the Supplier and the Buyer."),
        heading("§ 5 Haftung"),
        paragraph("Liability is limited to the annual fee."),
        paragraph("Neither party is liable for indirect loss."),
        heading("§ 6 Lieferung"),
        paragraph("Goods are delivered to the Buyer's warehouse."),
        heading("§ 7 Zahlung"),
        paragraph("Invoices are due within 30 days."),
        heading("§ 11 Kündigung"),
        paragraph("Either party may terminate with three months' notice."),
      ].join(""),
    ),
    "doc-A",
    "Off",
  );
}

const refOf = (snapshot: WordAuthoringSnapshot, text: string) =>
  snapshot.blocks.find((b) => b.text === text)!.ref;
const block = (id: string, text: string): WordPlanBlock => ({
  id,
  type: "paragraph",
  text,
});
const rewrite = (
  snapshot: WordAuthoringSnapshot,
  texts: string[],
  size = 40,
) => ({
  body: texts.map((text, i) => ({
    operation: "replace",
    source: [refOf(snapshot, text)],
    blocks: [block(`r${i}`, "x".repeat(size))],
  })),
});

/** A target read of the whole contract, then submissions under its token. */
async function targetRead(snapshot = contract()) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = await session.execute(
    {
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      target: {
        ref: snapshot.blocks[0].ref,
        throughRef: snapshot.blocks.at(-1)!.ref,
      },
    },
    context,
  );
  if (!read.ok) throw new Error(read.error);
  const readToken = (read.result as { readToken: string }).readToken;
  const execute = createWordDocumentSubmissionExecutor(session);
  let calls = 0;
  return {
    snapshot,
    sparse: (scoped_edit: Record<string, unknown>) =>
      execute(
        { snapshot: snapshot.token, readToken, scoped_edit },
        { ...context, toolCallId: `submit-${++calls}` },
      ),
  };
}

const receipt = (result: ClientToolExecutionResult) => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return (result as { result: Record<string, unknown> }).result;
};

describe("a smaller retry that leaves out parts", () => {
  it.each([
    ["after a target read", false],
    ["on a document too large for a complete read", true],
  ])(
    "names the parts the refused attempt changed %s, on the receipt and for the model",
    async (_case, tooLarge) => {
      const snapshot = contract();
      if (tooLarge) snapshot.completeReadIssue = "too-large";
      const s = await targetRead(snapshot);
      const sections = [
        "Liability is limited to the annual fee.",
        "Goods are delivered to the Buyer's warehouse.",
        "Either party may terminate with three months' notice.",
      ];
      const refused = await s.sparse(rewrite(s.snapshot, sections, 9000));
      expect(refused).toMatchObject({
        ok: false,
        validationErrors: [{ code: tooLarge ? "scoped-shape" : "too-large" }],
      });

      const result = receipt(
        await s.sparse(rewrite(s.snapshot, sections.slice(0, 1))),
      );
      expect(result.notInProposal).toEqual(["§ 6 Lieferung", "§ 11 Kündigung"]);
      expect(result.notInProposalNote).toBe(
        'Not in this proposal: "§ 6 Lieferung" and "§ 11 Kündigung", which an earlier attempt of this request changed. The card tells the user the same; name them when you describe this proposal.',
      );
    },
  );

  it("returns today's receipt for a plan accepted at the first attempt", async () => {
    const s = await targetRead();
    const result = receipt(
      await s.sparse(
        rewrite(s.snapshot, ["Liability is limited to the annual fee."]),
      ),
    );
    expect(Object.keys(result).sort()).toEqual([
      "action",
      "draft_id",
      "plan",
      "snapshot",
    ]);
  });

  it("names nothing when the retry keeps every part of the refused attempt", async () => {
    const s = await targetRead();
    const refused = await s.sparse({
      body: [
        {
          operation: "replace",
          source: [
            refOf(s.snapshot, "Liability is limited to the annual fee."),
          ],
          blocks: [block("same", "One"), block("same", "Two")],
        },
        {
          operation: "replace",
          source: [
            refOf(s.snapshot, "Goods are delivered to the Buyer's warehouse."),
          ],
          blocks: [block("d", "Delivered")],
        },
      ],
    });
    expect(refused.ok).toBe(false);
    const result = receipt(
      await s.sparse(
        rewrite(s.snapshot, [
          "Liability is limited to the annual fee.",
          "Goods are delivered to the Buyer's warehouse.",
        ]),
      ),
    );
    expect(result).not.toHaveProperty("notInProposal");
    expect(result).not.toHaveProperty("notInProposalNote");
  });
});

describe("wordPartsNotInProposal", () => {
  const blocksOf = (snapshot: WordAuthoringSnapshot, texts: string[]) =>
    new Set(
      texts.map((text) => snapshot.blocks.findIndex((b) => b.text === text)),
    );

  it("names text before the first heading by its first words", () => {
    const snapshot = contract();
    expect(
      wordPartsNotInProposal(
        snapshot,
        [
          blocksOf(snapshot, [
            "This contract is made between the Supplier and the Buyer.",
            "Invoices are due within 30 days.",
          ]),
        ],
        new Set(),
      ),
    ).toEqual(["This contract is made between the Suppli…", "§ 7 Zahlung"]);
  });

  it("counts an earlier attempt only when it changed more parts than the accepted plan", () => {
    const snapshot = contract();
    const earlier = blocksOf(snapshot, [
      "Liability is limited to the annual fee.",
      "Goods are delivered to the Buyer's warehouse.",
    ]);
    const swapped = blocksOf(snapshot, [
      "Liability is limited to the annual fee.",
      "Invoices are due within 30 days.",
    ]);
    expect(wordPartsNotInProposal(snapshot, [earlier], swapped)).toEqual([]);
    expect(
      wordPartsNotInProposal(
        snapshot,
        [earlier],
        blocksOf(snapshot, ["Neither party is liable for indirect loss."]),
      ),
    ).toEqual(["§ 6 Lieferung"]);
  });

  it("reads a full plan's changes, placing an insert by the source before it", () => {
    const snapshot = contract();
    const delivery = refOf(
      snapshot,
      "Goods are delivered to the Buyer's warehouse.",
    );
    const plan = {
      entries: snapshot.blocks.flatMap((b) =>
        b.ref === delivery
          ? [
              { kind: "keep", source: [b.ref] },
              { kind: "insert", blocks: [block("n", "Added")] },
            ]
          : [{ kind: "keep", source: [b.ref] }],
      ),
      deleted: [],
    };
    expect([...wordSubmissionBlocks(plan, snapshot)]).toEqual([
      snapshot.blocks.findIndex((b) => b.ref === delivery),
    ]);
  });
});

describe("wordNotInProposalReceipt", () => {
  it("adds nothing when no part is left out", () => {
    expect(wordNotInProposalReceipt([])).toBeUndefined();
  });

  it("keeps the model's note within what a replayed receipt keeps", () => {
    const names = Array.from(
      { length: 6 },
      (_, i) => `§ ${i + 1} ${"Gewährleistung und Mängelhaftung ".repeat(3)}`,
    );
    const note = wordNotInProposalReceipt(names)!.notInProposalNote;
    expect(
      new TextEncoder().encode(JSON.stringify(note)).length,
    ).toBeLessThanOrEqual(512);
    expect(note).toContain("and other parts");
    expect(wordNotInProposalReceipt(names)!.notInProposal).toEqual(names);
  });
});
