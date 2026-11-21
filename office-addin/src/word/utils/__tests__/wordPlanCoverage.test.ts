import { describe, expect, it } from "vitest";

import {
  heading,
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { okResult } from "../../../test/mocks/word/sectionFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";
import {
  wordNotInProposalReceipt,
  wordPartsNotInProposal,
  wordSubmissionBlocks,
} from "../wordPlanCoverage";

import type {
  WordAuthoringSnapshot,
  WordPlanBlock,
} from "@erato/frontend/word-review";

const context = { chatId: "chat-A", messageId: "message-A", toolCallId: "c" };

const capture = (xml: string[]) =>
  captureWordAuthoringSnapshot(packageXml(xml.join("")), "doc-A", "Off");

function contract() {
  return capture([
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
  ]);
}

/** Shaped like the probe's contract D1: every section has subsections. */
const NESTED: [string, [string, string][]][] = [
  [
    "§ 5 Haftung",
    [
      ["5.1 Haftungsgrenzen", "Liability is limited to the annual fee."],
      ["5.2 Ausschlüsse", "Neither party is liable for indirect loss."],
      ["5.3 Verjährung", "Claims lapse after one year."],
    ],
  ],
  [
    "§ 6 Lieferung und Logistik",
    [
      ["6.1 Lieferzeiten", "Goods are delivered within ten days."],
      ["6.2 Verpackung und Kennzeichnung", "Goods are packed for transport."],
      ["6.3 Gefahrübergang", "Risk passes on delivery."],
    ],
  ],
  [
    "§ 11 Datenschutz",
    [
      ["11.1 Datenschutz", "Personal data is processed lawfully."],
      ["11.2 Informationssicherheit", "Systems are kept secure."],
      ["11.3 Meldepflichten", "Incidents are reported within a day."],
    ],
  ],
];
const nested = (wrapper?: string) =>
  capture([
    ...(wrapper ? [heading(wrapper)] : []),
    ...NESTED.flatMap(([title, subsections]) => [
      heading(title, wrapper ? 2 : 1),
      ...subsections.flatMap(([subtitle, text]) => [
        heading(subtitle, wrapper ? 3 : 2),
        paragraph(text),
      ]),
    ]),
  ]);

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

/** A target read from `from` through `through` (the whole document by default), then
 * submissions under its token or a later complete read's. */
async function targetRead(
  snapshot = contract(),
  from = snapshot.blocks[0].ref,
  through = snapshot.blocks.at(-1)!.ref,
) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = okResult<{ readToken: string }>(
    await session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        target: { ref: from, throughRef: through },
      },
      context,
    ),
  );
  const execute = createWordDocumentSubmissionExecutor(session);
  let calls = 0;
  const submit = (input: Record<string, unknown>) =>
    execute(input, { ...context, toolCallId: `submit-${++calls}` });
  return {
    snapshot,
    submit,
    async completeRead(): Promise<string> {
      type Page = {
        complete: boolean;
        nextCursor: string | null;
        readToken?: string;
      };
      let cursor: string | null = null;
      for (;;) {
        const page: Page = okResult<Page>(
          await session.execute({ snapshot: snapshot.token, cursor }, context),
        );
        if (page.complete) return page.readToken!;
        cursor = page.nextCursor;
      }
    },
    sparse: (
      scoped_edit: Record<string, unknown>,
      readToken = read.readToken,
    ) => submit({ snapshot: snapshot.token, readToken, scoped_edit }),
  };
}

/** A full plan replacing the blocks with the given texts and keeping the rest. */
const fullPlan = (
  snapshot: WordAuthoringSnapshot,
  readToken: string,
  replaced: Record<string, WordPlanBlock>,
) => ({
  version: 1,
  snapshot: snapshot.token,
  readToken,
  scope: "body",
  entries: snapshot.blocks.map((b) =>
    replaced[b.text]
      ? { kind: "replace", source: [b.ref], blocks: [replaced[b.text]] }
      : { kind: "keep", source: [b.ref] },
  ),
  deleted: [],
});

const TODAYS_RECEIPT = ["action", "draft_id", "plan", "snapshot"];

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

      const result = okResult(
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
    const result = okResult(
      await s.sparse(
        rewrite(s.snapshot, ["Liability is limited to the annual fee."]),
      ),
    );
    expect(Object.keys(result).sort()).toEqual(TODAYS_RECEIPT);
  });

  it("returns today's receipt when the oversized change is resubmitted whole after the complete read", async () => {
    const s = await targetRead();
    const change = rewrite(
      s.snapshot,
      [
        "Liability is limited to the annual fee.",
        "Goods are delivered to the Buyer's warehouse.",
        "Either party may terminate with three months' notice.",
      ],
      9000,
    );
    expect(await s.sparse(change)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "too-large" }],
      submissionFeedback: { recovery: "read_current_context" },
    });
    const result = okResult(await s.sparse(change, await s.completeRead()));
    expect(Object.keys(result).sort()).toEqual(TODAYS_RECEIPT);
  });

  it("names the sections refused full plans and repairs changed that the accepted repair leaves out", async () => {
    const s = await targetRead();
    const plan = fullPlan(s.snapshot, await s.completeRead(), {
      "Liability is limited to the annual fee.": block("dup", "Capped"),
      "Goods are delivered to the Buyer's warehouse.": block("dup", "Sent"),
    });
    const draftOf = (refused: Awaited<ReturnType<typeof s.submit>>) => {
      expect(refused).toMatchObject({
        ok: false,
        validationErrors: [{ code: "duplicate-id" }],
      });
      if (refused.ok || !refused.submissionFeedback?.draft)
        throw new Error("Expected a repair handle");
      return {
        snapshot: s.snapshot.token,
        readToken: plan.readToken,
        draft_id: refused.submissionFeedback.draft.id,
        revision: refused.submissionFeedback.draft.revision,
      };
    };
    const at = (text: string) =>
      s.snapshot.blocks.findIndex((b) => b.text === text);
    const notice = "Either party may terminate with three months' notice.";
    const delivery = "Goods are delivered to the Buyer's warehouse.";
    const draft = draftOf(await s.submit(plan));
    const repaired = draftOf(
      await s.submit({
        ...draft,
        patches: [
          {
            op: "replace",
            path: `/entries/${at(notice)}`,
            value: {
              kind: "replace",
              source: [refOf(s.snapshot, notice)],
              blocks: [block("dup", "Ended")],
            },
          },
        ],
      }),
    );

    const result = okResult(
      await s.submit({
        ...repaired,
        patches: [notice, delivery].map((text) => ({
          op: "replace",
          path: `/entries/${at(text)}`,
          value: { kind: "keep", source: [refOf(s.snapshot, text)] },
        })),
      }),
    );
    expect(result.notInProposal).toEqual(["§ 6 Lieferung", "§ 11 Kündigung"]);
  });

  it("names no section a refused full plan only re-emitted unchanged", async () => {
    const s = await targetRead();
    const readToken = await s.completeRead();
    const invoices = "Invoices are due within 30 days.";
    expect(
      await s.submit(
        fullPlan(s.snapshot, readToken, {
          "Liability is limited to the annual fee.": block("dup", "Capped"),
          "Goods are delivered to the Buyer's warehouse.": block("dup", "Sent"),
          [invoices]: block("same", invoices),
        }),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "duplicate-id" }],
    });

    const result = okResult(
      await s.sparse(
        rewrite(s.snapshot, ["Liability is limited to the annual fee."]),
        readToken,
      ),
    );
    expect(result.notInProposal).toEqual(["§ 6 Lieferung"]);
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
    const result = okResult(
      await s.sparse(
        rewrite(s.snapshot, [
          "Liability is limited to the annual fee.",
          "Goods are delivered to the Buyer's warehouse.",
        ]),
      ),
    );
    expect(Object.keys(result).sort()).toEqual(TODAYS_RECEIPT);
  });

  it("names nothing for a refused ref the request never read", async () => {
    const snapshot = contract();
    const s = await targetRead(
      snapshot,
      refOf(snapshot, "§ 5 Haftung"),
      refOf(snapshot, "Neither party is liable for indirect loss."),
    );
    expect(
      await s.sparse(
        rewrite(s.snapshot, [
          "Liability is limited to the annual fee.",
          "Invoices are due within 30 days.",
        ]),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "outside-read-scope" }],
    });
    const result = okResult(
      await s.sparse(
        rewrite(s.snapshot, ["Liability is limited to the annual fee."]),
      ),
    );
    expect(Object.keys(result).sort()).toEqual(TODAYS_RECEIPT);
  });
});

describe("wordPartsNotInProposal", () => {
  const blocksOf = (snapshot: WordAuthoringSnapshot, texts: string[]) =>
    new Set(
      texts.map((text) => snapshot.blocks.findIndex((b) => b.text === text)),
    );
  const readAll = (snapshot: WordAuthoringSnapshot) => {
    snapshot.blocks.forEach((b) => snapshot.read.add(b.ref));
    return snapshot;
  };
  const cardNames = (
    snapshot: WordAuthoringSnapshot,
    earlier: Set<number>,
    accepted: Set<number>,
  ) =>
    wordNotInProposalReceipt(
      wordPartsNotInProposal(snapshot, [earlier], accepted),
    );

  it.each([
    ["section headings", undefined],
    ["section headings under one title heading", "Rahmenvertrag"],
  ])(
    "names whole sections, not their subsections, under %s",
    (_case, wrapper) => {
      const snapshot = readAll(nested(wrapper));
      const body = snapshot.blocks.flatMap((b, i) =>
        b.type === "heading" ? [] : [i],
      );
      const accepted = blocksOf(snapshot, [
        "Liability is limited to the annual fee.",
        "Neither party is liable for indirect loss.",
        "Claims lapse after one year.",
      ]);
      const expected = {
        notInProposal: ["§ 6 Lieferung und Logistik", "§ 11 Datenschutz"],
        notInProposalNote:
          'Not in this proposal: "§ 6 Lieferung und Logistik" and "§ 11 Datenschutz", which an earlier attempt of this request changed. The card tells the user the same; name them when you describe this proposal.',
      };
      expect(cardNames(snapshot, new Set(body), accepted)).toEqual(expected);
      expect(
        cardNames(
          snapshot,
          new Set(snapshot.blocks.map((_, i) => i)),
          accepted,
        ),
      ).toEqual(expected);
      expect(
        cardNames(
          snapshot,
          blocksOf(snapshot, [
            "Goods are delivered within ten days.",
            "Personal data is processed lawfully.",
          ]),
          accepted,
        )?.notInProposal,
      ).toEqual(["§ 6 Lieferung und Logistik", "§ 11 Datenschutz"]);
    },
  );

  it("names a subsection the retry left out of a section it still changes", () => {
    const snapshot = readAll(nested());
    expect(
      cardNames(
        snapshot,
        blocksOf(snapshot, [
          "Goods are delivered within ten days.",
          "Goods are packed for transport.",
        ]),
        blocksOf(snapshot, ["Goods are delivered within ten days."]),
      )?.notInProposal,
    ).toEqual(["6.2 Verpackung und Kennzeichnung"]);
  });

  it("names text before the first heading by its first words", () => {
    const snapshot = readAll(contract());
    expect(
      cardNames(
        snapshot,
        blocksOf(snapshot, [
          "This contract is made between the Supplier and the Buyer.",
          "Invoices are due within 30 days.",
        ]),
        new Set(),
      )?.notInProposal,
    ).toEqual(["“This contract is made between the Suppli…”", "§ 7 Zahlung"]);
  });

  it("names an untitled part by its first text when the changed block has none", () => {
    const snapshot = readAll(
      capture([
        paragraph(""),
        paragraph("Intro text that matters."),
        heading("§ 1 A"),
        paragraph("a1"),
        heading("§ 2 B"),
        paragraph("b1"),
      ]),
    );
    expect(
      cardNames(snapshot, new Set([0, 3, 5]), blocksOf(snapshot, ["a1"])),
    ).toEqual({
      notInProposal: ["“Intro text that matters.”", "§ 2 B"],
      notInProposalNote:
        'Not in this proposal: the passage beginning "Intro text that matters." and "§ 2 B", which an earlier attempt of this request changed. The card tells the user the same; name them when you describe this proposal.',
    });
  });

  it("still names a part without text", () => {
    const snapshot = readAll(
      capture([
        paragraph(""),
        heading("§ 1 A"),
        paragraph("a1"),
        heading("§ 2 B"),
        paragraph("b1"),
      ]),
    );
    expect(
      cardNames(snapshot, new Set([0, 2, 4]), blocksOf(snapshot, ["a1"])),
    ).toEqual({
      notInProposal: ["", "§ 2 B"],
      notInProposalNote:
        'Not in this proposal: a part without text and "§ 2 B", which an earlier attempt of this request changed. The card tells the user the same; name them when you describe this proposal.',
    });
  });

  it("counts an earlier attempt only when it changed more parts than the accepted plan", () => {
    const snapshot = readAll(contract());
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
    ).toEqual([{ title: "§ 6 Lieferung" }]);
  });

  it("reads a full plan's changes, placing an insert by the source before it and counting no implied move", () => {
    const snapshot = contract();
    const delivery = refOf(
      snapshot,
      "Goods are delivered to the Buyer's warehouse.",
    );
    const invoices = refOf(snapshot, "Invoices are due within 30 days.");
    const plan = {
      entries: snapshot.blocks.flatMap((b) =>
        b.ref === delivery
          ? [
              { kind: "keep", source: [b.ref] },
              { kind: "insert", blocks: [block("n", "Added")] },
            ]
          : b.ref === invoices
            ? [
                { kind: "keep", source: [b.ref] },
                { kind: "keep", source: [b.ref] },
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
    const titles = Array.from(
      { length: 6 },
      (_, i) => `§ ${i + 1} ${"Gewährleistung und Mängelhaftung ".repeat(3)}`,
    );
    const receipt = wordNotInProposalReceipt(
      titles.map((title) => ({ title })),
    )!;
    expect(
      new TextEncoder().encode(JSON.stringify(receipt.notInProposalNote))
        .length,
    ).toBeLessThanOrEqual(512);
    expect(receipt.notInProposalNote).toContain("and other parts");
    expect(receipt.notInProposal).toEqual(titles);
  });

  it("names as many parts for the model as the card shows", () => {
    const receipt = wordNotInProposalReceipt(
      ["§ 1", "§ 2", "§ 3", "§ 4", "§ 5", "§ 6"].map((title) => ({ title })),
    )!;
    expect(receipt.notInProposalNote).toMatch(
      /^Not in this proposal: "§ 1", "§ 2", "§ 3", "§ 4", "§ 5" and other parts, /,
    );
  });
});
