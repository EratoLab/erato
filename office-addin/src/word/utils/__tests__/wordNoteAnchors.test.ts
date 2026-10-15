import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  wordNoteAnchorText,
  wordSourceReadRefs,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  packageXml,
  paragraph,
} from "../../../test/mocks/word/authoringFixtures";
import { parseWordXml } from "../wordDocumentPackageCodec";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanDiagnostics,
  WordPlanEntry,
} from "@erato/frontend/word-review";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const run = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const cell = (text: string) => `<w:tc>${paragraph(text)}</w:tc>`;
const BLOCKS = {
  /** Two paragraphs one bookmark holds together, so they are one block. */
  multi: `<w:p><w:bookmarkStart w:id="1" w:name="Kept"/>${run("Alpha beta")}</w:p><w:p>${run("Gamma delta")}<w:bookmarkEnd w:id="1"/></w:p>`,
  table: `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr>${cell("Team")}${cell("Hours")}</w:tr><w:tr>${cell("East")}${cell("18")}</w:tr></w:tbl>`,
  hidden: `<w:p>${run("Visible ")}${run("SECRET ", "<w:vanish/>")}${run("tail")}</w:p>`,
  deleted: `<w:p>${run("Keep ")}<w:del w:id="5" w:author="A"><w:r><w:delText>gone </w:delText></w:r></w:del>${run("this")}</w:p>`,
};

function snapshotOf(body: string): WordAuthoringSnapshot {
  const snapshot = captureWordAuthoringSnapshot(
    packageXml(paragraph("Opening.") + body + paragraph("Closing.")),
    "doc-A",
    "Off",
    true,
  );
  snapshot.read = new Set(wordSourceReadRefs(snapshot));
  snapshot.readToken = "read-proof";
  expect(snapshot.issue).toBeUndefined();
  return snapshot;
}

function notePlan(
  snapshot: WordAuthoringSnapshot,
  anchor: { block: string; start?: number },
  entries: WordPlanEntry[] = [
    { kind: "keep", source: snapshot.blocks.map((b) => b.ref) },
  ],
): WordDocumentPlan {
  return {
    version: 1,
    snapshot: snapshot.token,
    readToken: "read-proof",
    scope: "document",
    entries,
    deleted: [],
    stories: [
      {
        kind: "upsert",
        type: "footnote",
        id: "note",
        blocks: [{ id: "note-text", type: "paragraph", text: "A note." }],
        anchor,
      },
    ],
  };
}

/** The anchor block's view with "§" where the note reference landed. */
function placed(snapshot: WordAuthoringSnapshot, plan: WordDocumentPlan) {
  const parsed = parseWordDocumentPlan(JSON.stringify(plan))!;
  expect(validateWordDocumentPlan(parsed, snapshot)).toBeNull();
  const doc = parseWordXml(compileWordDocumentPlan(parsed, snapshot));
  const reference = doc.getElementsByTagNameNS(W, "footnoteReference")[0];
  const marker = reference.parentElement!;
  const t = doc.createElementNS(W, "w:t");
  t.textContent = "§";
  marker.replaceChildren(t);
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const nodes = Array.from(body.children).filter(
    (e) => e.localName !== "sectPr",
  );
  // The block sits between the opening and closing paragraphs.
  return wordNoteAnchorText(nodes.slice(1, -1));
}

describe("note anchors count in the validator's text view (F7)", () => {
  it.each(Object.entries(BLOCKS))(
    "reads a %s block as the read returned it",
    (_, xml) => {
      const snapshot = snapshotOf(xml);
      const block = snapshot.blocks[1];
      const doc = parseWordXml(snapshot.ooxml);
      const body = doc.getElementsByTagNameNS(W, "body")[0];
      const nodes = Array.from(body.children).filter(
        (e) => e.localName !== "sectPr",
      );
      expect(wordNoteAnchorText(nodes.slice(1, -1))).toBe(block.text);
    },
  );

  it.each([
    ["multi", "Gamma", "Alpha beta\n§Gamma delta"],
    ["table", "18", "Team\tHours\nEast\t§18"],
    ["hidden", "tail", "Visible §tail"],
    ["deleted", "this", "Keep §this"],
  ] as const)(
    "places a note in a %s block before the character its offset names",
    (kind, word, expected) => {
      const snapshot = snapshotOf(BLOCKS[kind]);
      const block = snapshot.blocks[1];
      const start = block.text.indexOf(word);
      expect(
        placed(snapshot, notePlan(snapshot, { block: block.ref, start })),
      ).toBe(expected);
    },
  );

  it("places a note without an offset after the block's last character, and at its end offset alike", () => {
    const snapshot = snapshotOf(BLOCKS.table);
    const block = snapshot.blocks[1];
    expect(placed(snapshot, notePlan(snapshot, { block: block.ref }))).toBe(
      "Team\tHours\nEast\t18§",
    );
    expect(
      placed(
        snapshot,
        notePlan(snapshot, { block: block.ref, start: block.text.length }),
      ),
    ).toBe("Team\tHours\nEast\t18§");
  });

  it("counts a new paragraph in its own text", () => {
    const snapshot = snapshotOf(BLOCKS.hidden);
    const refs = snapshot.blocks.map((b) => b.ref);
    const plan = notePlan(snapshot, { block: "fresh", start: 4 }, [
      { kind: "keep", source: [refs[0]] },
      {
        kind: "replace",
        source: [refs[1]],
        blocks: [
          {
            id: "fresh",
            type: "paragraph",
            text: "New\ttext",
            runs: [{ text: "New\t" }, { text: "text", bold: true }],
          },
        ],
      },
      { kind: "keep", source: [refs[2]] },
    ]);
    expect(placed(snapshot, plan)).toBe("New\t§text");
  });

  it("refuses an offset past the view, and an offset into a new block whose text Word does not show as given", () => {
    const snapshot = snapshotOf(BLOCKS.table);
    const block = snapshot.blocks[1];
    const issues: WordPlanDiagnostics = [];
    expect(
      validateWordDocumentPlan(
        notePlan(snapshot, { block: block.ref, start: block.text.length + 1 }),
        snapshot,
        issues,
      ),
    ).toBe("invalid");
    expect(issues[0]).toMatchObject({
      path: "/stories/0/anchor",
      code: "anchor-range",
    });
    const refs = snapshot.blocks.map((b) => b.ref);
    const table = (start?: number) =>
      notePlan(snapshot, { block: "fresh-table", start }, [
        { kind: "keep", source: [refs[0]] },
        {
          kind: "replace",
          source: [refs[1]],
          blocks: [
            {
              id: "fresh-table",
              type: "table",
              text: "",
              rows: [
                {
                  cells: [
                    {
                      blocks: [{ id: "c1", type: "paragraph", text: "Cell" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { kind: "keep", source: [refs[2]] },
      ]);
    const refused: WordPlanDiagnostics = [];
    expect(validateWordDocumentPlan(table(0), snapshot, refused)).toBe(
      "invalid",
    );
    expect(refused[0].message).toContain("omit start");
    expect(validateWordDocumentPlan(table(), snapshot)).toBeNull();
    expect(
      placed(
        snapshot,
        notePlan(snapshot, { block: "c1", start: 2 }, table().entries),
      ),
    ).toBe("Ce§ll");
  });
});
