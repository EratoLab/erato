import { readFileSync } from "node:fs";

import {
  canonicalWordPlan,
  validateWordDocumentPlan,
  wordPartsProgress,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  recordPartsTurn,
  wordCaptureJournal,
} from "../../../test/mocks/word/partsTurn";
import { wordDocumentFileToOoxml } from "../wordDocumentPackage";
import {
  assembleWordParts,
  parseWordPartOps,
  parseWordPartsPlan,
  wordPartRows,
  wordPartsApplied,
  wordPartsChangedInWord,
  wordPartsFromContent,
  wordPartsWithout,
} from "../wordDocumentParts";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
} from "../wordDocumentXml";
import { wordInPlaceCapabilities } from "../wordInPlaceCapabilities";
import { routeWordDocumentPlan } from "../wordInPlaceRoute";

import type { WordPartOp, WordPartsDraft } from "../wordDocumentParts";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

const FIXTURES = `${process.cwd()}/src/test/fixtures/word-parts`;
const CONTRACT = new Uint8Array(
  readFileSync(`${FIXTURES}/framework-contract.docx`),
);
const T1 = JSON.parse(readFileSync(`${FIXTURES}/t1-parts.json`, "utf8")) as {
  plan: Record<string, unknown> & { rows: Record<string, string>[] };
  parts: { row: number; ops: Record<string, string>[] }[];
};

const capture = () =>
  captureWordAuthoringSnapshot(
    wordDocumentFileToOoxml(CONTRACT),
    "Rahmenvertrag.docx",
    "Off",
    true,
  );

function route(plan: WordDocumentPlan, snapshot: WordAuthoringSnapshot) {
  const compiled = captureWordAuthoringSnapshot(
    compileWordDocumentPlan(plan, snapshot),
    snapshot.identity,
    "Off",
    true,
    "verify",
  );
  return routeWordDocumentPlan(
    plan,
    snapshot,
    { enabled: true },
    wordInPlaceCapabilities("PC"),
    compiled,
  );
}

const rows = (sources: [string, string][]) =>
  sources.map(([source, action]) => ({
    source,
    action,
    ...(action === "rewrite" ? { change: "Plainer wording." } : {}),
  }));

/** One paragraph of § 6 whose rewrite alone Word PC writes in place. */
function inPlaceParagraph(snapshot: WordAuthoringSnapshot): string {
  const input = {
    intent: "Plainer wording.",
    rows: rows([
      ["b1-b143", "keep"],
      ["b144-b178", "rewrite"],
      ["b179-b422", "keep"],
    ]),
  };
  const parsed = parseWordPartsPlan(input, snapshot);
  if ("issues" in parsed) throw new Error(JSON.stringify(parsed.issues));
  for (const block of snapshot.blocks.slice(145, 178)) {
    if (block.type !== "paragraph") continue;
    const ops = parseWordPartOps(
      opsReplacing(block.ref),
      1,
      parsed.plan.rows[1],
      snapshot,
    );
    if ("issues" in ops) continue;
    const plan = assembleWordParts(
      snapshot,
      "read",
      parsed.plan,
      new Map([[1, ops.ops]]),
    ).plan;
    if (route(plan, snapshot).route === "in-place") return block.ref;
  }
  throw new Error("no paragraph of § 6 is written in place");
}

const opsReplacing = (ref: string) => {
  const at = Number(ref.slice(1));
  return [
    ...(at > 144 ? [{ keep: `b144-b${at - 1}` }] : []),
    { replace: ref, text: "Dieser Absatz ist kürzer gefasst." },
    ...(at < 178 ? [{ keep: `b${at + 1}-b178` }] : []),
  ];
};

describe("a finished change in parts, row by row", { timeout: 60_000 }, () => {
  it("rebuilds the accepted plan exactly from the calls stored in the chat", async () => {
    const snapshot = capture();
    const turn = await recordPartsTurn(snapshot, T1);
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    const accepted = (turn.last.result as { plan: WordDocumentPlan }).plan;
    const rebuilt = wordPartsFromContent(turn.content, snapshot)!;
    expect(rebuilt.changed.size).toBe(0);
    expect(
      canonicalWordPlan(
        assembleWordParts(
          snapshot,
          rebuilt.draft.readToken,
          rebuilt.draft.plan,
          rebuilt.draft.parts,
        ).plan,
      ),
    ).toBe(canonicalWordPlan(accepted));
    const progress = wordPartsProgress(turn.content, false)!;
    expect(progress.finished).toBeDefined();
    expect(progress.structure?.moves.map((move) => move.title)).toEqual([
      "§ 7 Preise und Zahlungsbedingungen",
      "§ 12 Notfall- und Eskalationsmanagement",
    ]);
    expect(progress.rows.every((row) => row.state === "ready")).toBe(true);
  });

  it("sends the rest in place once the reordering is left out", async () => {
    const snapshot = capture();
    const ref = inPlaceParagraph(snapshot);
    const turn = await recordPartsTurn(snapshot, {
      plan: {
        intent: "§ 7 before § 5, and § 6 in plainer wording.",
        rows: rows([
          ["b1-b98", "keep"],
          ["b179-b214", "keep"],
          ["b99-b143", "keep"],
          ["b144-b178", "rewrite"],
          ["b215-b422", "keep"],
        ]),
      },
      parts: [{ row: 4, ops: opsReplacing(ref) }],
    });
    if (!turn.last.ok) throw new Error(JSON.stringify(turn.last));
    const accepted = (turn.last.result as { plan: WordDocumentPlan }).plan;
    expect(route(accepted, snapshot)).toMatchObject({
      route: "import",
      reason: "moved",
    });
    const { draft } = wordPartsFromContent(turn.content, snapshot)!;
    const without = wordPartsWithout(
      draft.plan,
      draft.parts,
      { rows: new Set(), structure: true },
      snapshot,
    );
    expect(without.plan.rows.map((row) => row.refs[0])).toEqual([
      "b1",
      "b99",
      "b144",
      "b179",
      "b215",
    ]);
    const effective = assembleWordParts(
      snapshot,
      draft.readToken,
      without.plan,
      without.parts,
    ).plan;
    expect(validateWordDocumentPlan(effective, snapshot)).toBeNull();
    expect(route(effective, snapshot)).toMatchObject({ route: "in-place" });
  });

  it("leaves one row out as it was, and a merge of distant blocks with the reordering", () => {
    const snapshot = capture();
    const parsed = parseWordPartsPlan(
      {
        intent: "Merge § 5 into § 7 and rewrite § 6.",
        rows: rows([
          ["b1-b98", "keep"],
          ["b144-b178", "rewrite"],
          ["b99-b143,b179-b214", "rewrite"],
          ["b215-b422", "keep"],
        ]),
      },
      snapshot,
    );
    if ("issues" in parsed) throw new Error(JSON.stringify(parsed.issues));
    const parts = new Map<number, WordPartOp[]>([
      [1, [{ kind: "keep", refs: parsed.plan.rows[1].refs }]],
      [2, [{ kind: "keep", refs: parsed.plan.rows[2].refs }]],
    ]);
    const one = wordPartsWithout(
      parsed.plan,
      parts,
      { rows: new Set([1]), structure: false },
      snapshot,
    );
    expect(one.plan.rows.map((row) => row.action)).toEqual([
      "keep",
      "keep",
      "rewrite",
      "keep",
    ]);
    expect([...one.parts.keys()]).toEqual([2]);
    const reordered = wordPartsWithout(
      parsed.plan,
      parts,
      { rows: new Set(), structure: true },
      snapshot,
    );
    expect(reordered.plan.rows.map((row) => [row.refs[0], row.action])).toEqual(
      [
        ["b1", "keep"],
        ["b99", "keep"],
        ["b144", "rewrite"],
        ["b179", "keep"],
        ["b215", "keep"],
      ],
    );
    expect([...reordered.parts.keys()]).toEqual([2]);
  });

  it("keeps a merge of neighbouring sections as its own row when the reordering is left out", () => {
    const snapshot = capture();
    const parsed = parseWordPartsPlan(
      {
        intent: "A moved passage, and § 6 and § 7 as one section.",
        rows: rows([
          ["b1-b98", "keep"],
          ["b215-b230", "keep"],
          ["b99-b143", "keep"],
          ["b144-b178,b179-b214", "rewrite"],
          ["b231-b422", "keep"],
        ]),
      },
      snapshot,
    );
    if ("issues" in parsed) throw new Error(JSON.stringify(parsed.issues));
    const merged = parsed.plan.rows[3];
    const part = [{ kind: "keep" as const, refs: merged.refs }];
    const draft: WordPartsDraft = {
      id: "d",
      revision: 1,
      readToken: "read",
      plan: parsed.plan,
      parts: new Map([[3, part]]),
    };
    expect(wordPartRows(draft, snapshot)[3].title).toContain(" – ");
    const flat = wordPartsWithout(
      parsed.plan,
      draft.parts,
      { rows: new Set(), structure: true },
      snapshot,
    );
    const at = flat.plan.rows.findIndex((row) => row.refs[0] === "b144");
    expect(flat.plan.rows[at]).toMatchObject({ action: "rewrite" });
    expect(flat.plan.rows[at].refs).toEqual(merged.refs);
    expect(flat.parts.get(at)).toBe(part);
    expect(flat.rows[at]).toBe(3);
  });

  it("names each review row of what Apply writes by its section plan row, also once rows are re-sorted", async () => {
    const snapshot = capture();
    const ref = inPlaceParagraph(snapshot);
    const turn = await recordPartsTurn(snapshot, {
      plan: {
        intent: "§ 7 before § 5, and § 6 in plainer wording.",
        rows: rows([
          ["b1-b98", "keep"],
          ["b179-b214", "keep"],
          ["b99-b143", "keep"],
          ["b144-b178", "rewrite"],
          ["b215-b422", "keep"],
        ]),
      },
      parts: [{ row: 4, ops: opsReplacing(ref) }],
    });
    const { draft } = wordPartsFromContent(turn.content, snapshot)!;
    for (const structure of [false, true]) {
      const applied = wordPartsApplied(draft, snapshot, {
        rows: new Set(),
        structure,
      });
      const written = applied.plan.entries.find(
        (entry) => entry.kind === "replace",
      );
      if (written?.kind !== "replace") throw new Error("no replace");
      expect(applied.sectionRowOf(`output:${written.blocks[0].id}`)).toBe(4);
      expect(applied.sectionRowOf(`replaced:${ref}`)).toBe(4);
      expect(applied.sectionRowOf("keep:b180")).toBe(2);
    }
  });

  it("drops a rename only when Word changed its heading, not the section's text", () => {
    const snapshot = capture();
    const parsed = parseWordPartsPlan(
      {
        intent: "Renumber § 6.",
        rows: [
          { source: "b1-b143", action: "keep" },
          {
            source: "b144-b178",
            action: "keep",
            title: "§ 6 Neue Überschrift",
          },
          { source: "b179-b422", action: "keep" },
        ],
      },
      snapshot,
    );
    if ("issues" in parsed) throw new Error(JSON.stringify(parsed.issues));
    const draft = { plan: parsed.plan, parts: new Map() };
    const { capture: read, edit } = wordCaptureJournal(snapshot);
    edit("b150");
    expect([...wordPartsChangedInWord(draft, snapshot, read)]).toEqual([]);
    edit("b144");
    expect([...wordPartsChangedInWord(draft, snapshot, read)]).toEqual([1]);
  });
});
