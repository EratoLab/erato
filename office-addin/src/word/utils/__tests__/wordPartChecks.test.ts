import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sectionSnapshot } from "../../../test/mocks/word/sectionFixtures";
import {
  openWordParts,
  partsReceipt,
  partsRejection,
  WORD_PARTS_FIXTURES,
} from "../../../test/mocks/word/wordPartsTurn";
import {
  assembleWordParts,
  parseWordPartOps,
  parseWordPartsPlan,
  wordPartRefs,
} from "../wordDocumentParts";
import {
  checkWordPart,
  wordPartsReferenceIssues,
  wordPartsUncoveredSections,
  wordSectionLabels,
} from "../wordPartChecks";

import type { SectionBlock } from "../../../test/mocks/word/sectionFixtures";
import type { WordPartRow } from "../wordDocumentParts";
import type { WordPartAllow } from "../wordPartChecks";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
} from "@erato/frontend/word-review";

const T1 = JSON.parse(
  readFileSync(`${WORD_PARTS_FIXTURES}/t1-parts.json`, "utf8"),
) as {
  plan: { intent: string; terms: string[]; rows: Record<string, string>[] };
  parts: { row: number; ops: Record<string, string>[] }[];
};
const PROBE = JSON.parse(
  readFileSync(`${WORD_PARTS_FIXTURES}/probe-review-cases.json`, "utf8"),
) as {
  sections: Record<string, string>;
  parts: Record<string, { section: number; after: Record<string, string> }>;
  cases: {
    id: string;
    kind: string;
    base: string;
    after?: Record<string, string>;
    kept?: string[];
    expect: { code: string; ref?: string; refs?: string[] }[];
  }[];
};
/** The rows of § 5, § 6 and § 11 in the T1 section plan. */
const ROW: Record<number, number> = { 5: 3, 6: 4, 11: 7 };
/** The T1 plan's terms, plus the one the term drift case is about. */
const TERMS = [...T1.plan.terms, "Warenannahme"];
const KEPT_ON_PURPOSE = ["kept-unchanged"];

/** A probe part as the writer would send it: kept blocks by reference, each run of rewritten
 * paragraphs as one replace with a line per paragraph. */
function probeOps(
  snapshot: WordAuthoringSnapshot,
  section: number,
  after: Record<string, string>,
  kept: readonly string[] = [],
) {
  const refs = wordPartRefs(PROBE.sections[section], snapshot) as string[];
  const ops: Record<string, string>[] = [];
  let run: string[] = [];
  let replacing = false;
  const flush = () => {
    if (!run.length) return;
    const source = `${run[0]}-${run.at(-1)}`;
    ops.push(
      replacing
        ? { replace: source, text: run.map((ref) => after[ref]).join("\n") }
        : { keep: source },
    );
    run = [];
  };
  for (const ref of refs) {
    const replace = ref in after && !kept.includes(ref);
    if (replace !== replacing) {
      flush();
      replacing = replace;
    }
    run.push(ref);
  }
  flush();
  return ops;
}

const caseOps = (
  snapshot: WordAuthoringSnapshot,
  probeCase: (typeof PROBE.cases)[number],
) => {
  const base = PROBE.parts[probeCase.base];
  return probeOps(
    snapshot,
    base.section,
    { ...base.after, ...probeCase.after },
    probeCase.kept,
  );
};

async function planned(terms = TERMS, request?: string) {
  const doc = await openWordParts({ request });
  const { draft_id } = partsReceipt(await doc.plan({ ...T1.plan, terms }));
  return { doc, draft_id };
}

/** Rows 5 and 6 of the T1 writer: a list becomes a table, a heading is merged away; their other
 * paragraphs stay as they are on purpose. */
async function writeStructureRows(
  doc: Awaited<ReturnType<typeof openWordParts>>,
  draft: string,
) {
  let revision = 0;
  for (const part of T1.parts.filter(({ row }) => row === 5 || row === 6))
    ({ revision } = partsReceipt(
      await doc.write(draft, part.row, part.ops, undefined, KEPT_ON_PURPOSE),
    ));
  return revision;
}

describe("code checks per part and at finish", { timeout: 120_000 }, () => {
  it("accepts all 192 faithful paragraphs and finishes with them", async () => {
    const faithful = Object.entries(PROBE.parts).filter(([id]) =>
      id.startsWith("C-"),
    );
    expect(
      faithful.reduce((n, [, part]) => n + Object.keys(part.after).length, 0),
    ).toBe(192);
    for (const run of ["t1", "t2"]) {
      const { doc, draft_id } = await planned();
      for (const section of [5, 6, 11]) {
        const written = partsReceipt(
          await doc.write(
            draft_id,
            ROW[section],
            probeOps(
              doc.snapshot,
              section,
              PROBE.parts[`C-T1-V4-sol-${run}__S${section}`].after,
            ),
          ),
        );
        expect(written.allowed).toBeUndefined();
      }
      const revision = await writeStructureRows(doc, draft_id);
      const finished = await doc.finish(draft_id, revision);
      expect(finished.ok, JSON.stringify(finished)).toBe(true);
      const rows = (finished as { result: { rows: unknown[] } }).result.rows;
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 3, status: "ready" }),
          expect.objectContaining({ row: 5, allowed: KEPT_ON_PURPOSE }),
        ]),
      );
      expect(
        rows.filter((row) => (row as { allowed?: unknown }).allowed),
      ).toHaveLength(2);
    }
  });

  it("refuses every seeded number, term and scope slip with a message that names it", async () => {
    const seeded = PROBE.cases.filter((c) =>
      c.expect.some(({ code }) => code !== "cross-reference"),
    );
    expect(seeded.map((c) => c.id)).toEqual([
      "R-T1-V4-qwen-t1__S11",
      "S-Va-T1-V4-sol-t1__S5",
      "S-Vc-T1-V4-sol-t1__S11",
      "S-Vd-T1-V4-sol-t2__S5",
      "S-Vh-T1-V4-sol-t2__S6",
      "S-Vj-T1-V4-sol-t2__S5",
      "X-X1-T1-V4-sol-t1__S6",
      "P-keptbyref-T1-V4-sol-t2__S11",
      "P-verbatim-T1-V4-sol-t1__S6",
    ]);
    const found: Record<
      string,
      { path: string; code: string; message: string }[]
    > = {};
    for (const probeCase of seeded) {
      const { doc, draft_id } = await planned();
      const refused = partsRejection(
        await doc.write(
          draft_id,
          ROW[PROBE.parts[probeCase.base].section],
          caseOps(doc.snapshot, probeCase),
        ),
      );
      found[probeCase.id] = refused?.validationErrors ?? [];
      expect(refused?.submissionFeedback).toMatchObject({
        terminal: false,
        recovery: "repair_arguments",
      });
      for (const slip of probeCase.expect) {
        const codes =
          slip.code === "scope" ? ["row-scope", "kept-unchanged"] : [slip.code];
        expect(found[probeCase.id], probeCase.id).toContainEqual(
          expect.objectContaining({
            code: expect.stringMatching(new RegExp(`^(${codes.join("|")})$`)),
            message: expect.stringContaining(slip.ref ?? slip.refs![0]),
          }),
        );
      }
    }
    expect(found["S-Va-T1-V4-sol-t1__S5"]).toEqual([
      {
        path: "/ops/1/text",
        code: "numbers",
        message:
          'Line 7 has 80 where b107 has 70. Keep every number and amount as the original writes it. If changing this number is intended, send the part again with allow: ["numbers"].',
      },
    ]);
    expect(found["R-T1-V4-qwen-t1__S11"]).toContainEqual({
      path: "/ops/5/text",
      code: "clause-numbering",
      message:
        'Line 4 has (14) where b341 has (4). Keep each paragraph\'s clause number as the original has it. If changing the clause numbering is intended, send the part again with allow: ["clause-numbering"].',
    });
    expect(found["X-X1-T1-V4-sol-t1__S6"]).toEqual([
      expect.objectContaining({
        code: "term",
        message: expect.stringMatching(
          /^Line 2 drops Warenannahme, which b147 has\. Keep the section plan's terms/,
        ),
      }),
      expect.objectContaining({ code: "term", path: "/ops/5/text" }),
      expect.objectContaining({ code: "term", path: "/ops/7/text" }),
    ]);
    expect(found["P-keptbyref-T1-V4-sol-t2__S11"]).toEqual([
      {
        path: "/ops",
        code: "kept-unchanged",
        message:
          "This part leaves 27 of the row's 39 body paragraphs unchanged (kept: b315-b321,b323-b336,b338-b342,b349). Rewrite them as the row's change says, or, if they stay as they are on purpose, send the part again with allow: [\"kept-unchanged\"].",
      },
    ]);
    expect(found["P-verbatim-T1-V4-sol-t1__S6"]).toEqual([
      {
        path: "/ops/5/text",
        code: "row-scope",
        message:
          'Lines 4–12 repeat b157-b165 word for word. Keep a block that stays as it is by reference with {"keep":…}, and rewrite the others as the row\'s change says.',
      },
      expect.objectContaining({
        path: "/ops/7/text",
        code: "row-scope",
        message: expect.stringMatching(/^Line 1 repeats b168 word for word/),
      }),
    ]);
  });

  it("refuses at finish new references to sections the change moves or merges, naming the row, and leaves the row out when the finish comes again", async () => {
    const probeCase = PROBE.cases.find((c) => c.id.startsWith("X-X2"))!;
    const { doc, draft_id } = await planned();
    partsReceipt(
      await doc.write(draft_id, ROW[6], caseOps(doc.snapshot, probeCase)),
    );
    for (const section of [5, 11])
      partsReceipt(
        await doc.write(
          draft_id,
          ROW[section],
          probeOps(
            doc.snapshot,
            section,
            PROBE.parts[`C-T1-V4-sol-t2__S${section}`].after,
          ),
        ),
      );
    const revision = await writeStructureRows(doc, draft_id);
    const refused = partsRejection(await doc.finish(draft_id, revision));
    const leave = `Send row 4 again with write_document_section, or finish again at revision ${revision} to leave it unchanged; the card then says so.`;
    expect(refused?.validationErrors).toEqual([
      {
        path: "",
        code: "cross-reference",
        message: `Row 4 (§ 6 Lieferung und Logistik), at /ops/5/text line 7: Refers to § 10 Haftung, whose heading this change deletes; refer to the section that now holds its text, or leave the reference out. ${leave}`,
      },
      {
        path: "",
        code: "cross-reference",
        message: `Row 4 (§ 6 Lieferung und Logistik), at /ops/7/text line 10: Adds a reference to § 12 Notfall- und Eskalationsmanagement, which this change moves and the original row does not refer to; leave it out, or, if the request asks for it, send the row again with allow: ["cross-reference"]. ${leave}`,
      },
    ]);
    const finished = await doc.finish(draft_id, revision);
    expect(finished.ok, JSON.stringify(finished)).toBe(true);
    const result = (finished as { result: Record<string, unknown> }).result;
    expect(result.notInProposal).toEqual(["§ 6 Lieferung und Logistik"]);
    expect(result.rows).toContainEqual(
      expect.objectContaining({ row: 4, status: "not_written" }),
    );
    const plan = result.plan as WordDocumentPlan;
    expect(
      plan.entries.some((e) => e.kind === "keep" && e.source.includes("b157")),
    ).toBe(true);
  });

  it("names unwritten rows and the checks' findings in one refusal, and a fixed row finishes", async () => {
    const probeCase = PROBE.cases.find((c) => c.id.startsWith("X-X2"))!;
    const { doc, draft_id } = await planned();
    partsReceipt(
      await doc.write(
        draft_id,
        ROW[5],
        probeOps(doc.snapshot, 5, PROBE.parts["C-T1-V4-sol-t2__S5"].after),
      ),
    );
    const { revision } = partsReceipt(
      await doc.write(draft_id, ROW[6], caseOps(doc.snapshot, probeCase)),
    );
    expect(
      partsRejection(
        await doc.finish(draft_id, revision),
      )?.validationErrors?.map(({ code }) => code),
    ).toEqual(["rows-not-written", "cross-reference"]);
    const fixed = partsReceipt(
      await doc.write(
        draft_id,
        ROW[6],
        probeOps(doc.snapshot, 6, PROBE.parts["C-T1-V4-sol-t2__S6"].after),
      ),
    );
    const finished = await doc.finish(draft_id, fixed.revision);
    expect(finished.ok, JSON.stringify(finished)).toBe(true);
    expect(
      (finished as { result: { notInProposal: string[] } }).result
        .notInProposal,
    ).toHaveLength(3);
  });

  it("names announced sections that end up unchanged (T3)", async () => {
    const request =
      "Bitte schreibe „§ 5 Bestellungen und Abrufe“, „§ 6 Lieferung und Logistik“ und „§ 11 Datenschutz und Informationssicherheit“ für eine neue Zielgruppe neu.";
    const rows = (rewrite: string[]) =>
      [
        ["b1-b98", "keep"],
        ["b99-b143", rewrite.includes("§ 5") ? "rewrite" : "keep"],
        ["b144-b178", rewrite.includes("§ 6") ? "rewrite" : "keep"],
        ["b179-b306", "keep"],
        ["b307-b349", rewrite.includes("§ 11") ? "rewrite" : "keep"],
        ["b350-b422", "keep"],
      ].map(([source, action]) =>
        action === "rewrite"
          ? { source, action, change: "Für Disponenten." }
          : { source, action },
      );
    const doc = await openWordParts({ request });
    const narrow = partsReceipt(
      await doc.plan({ ...T1.plan, rows: rows(["§ 5"]) }),
    );
    expect(narrow.fix_requests).toEqual([
      {
        title: "§ 6 Lieferung und Logistik",
        issues: [
          {
            code: "section-not-covered",
            message:
              "The request names § 6 Lieferung und Logistik, and no row of this section plan changes it. If the request asks to change it, send the section plan again with a rewrite row for it; if it names it only for context, go on.",
          },
        ],
      },
      expect.objectContaining({
        title: "§ 11 Datenschutz und Informationssicherheit",
      }),
    ]);
    expect(
      partsReceipt(await doc.plan({ ...T1.plan, rows: rows(["§ 5"]) }))
        .fix_requests,
    ).toBeUndefined();

    const { draft_id } = partsReceipt(
      await doc.plan({ ...T1.plan, rows: rows(["§ 5", "§ 6", "§ 11"]) }),
    );
    expect(
      partsRejection(await doc.write(draft_id, 3, [{ keep: "b144-b178" }]))
        ?.validationErrors,
    ).toEqual([
      {
        path: "/ops",
        code: "row-scope",
        message:
          "This part keeps every block of row 3 as it is. Rewrite the blocks as the row's change says, or send the section plan again with row 3 as a keep row.",
      },
    ]);
    const { revision } = partsReceipt(
      await doc.write(
        draft_id,
        2,
        probeOps(doc.snapshot, 5, PROBE.parts["C-T1-V4-sol-t1__S5"].after),
      ),
    );
    expect(
      partsRejection(await doc.finish(draft_id, revision))?.validationErrors,
    ).toEqual([
      expect.objectContaining({
        code: "rows-not-written",
        message: expect.stringMatching(
          /^Row 3 \(§ 6 Lieferung und Logistik\) and Row 5 \(§ 11 Datenschutz und Informationssicherheit\) have no part yet/,
        ),
      }),
    ]);
  });

  it("refuses the T1 writer's own slips, and lists on the receipt what a part allows", async () => {
    const { doc, draft_id } = await planned(T1.plan.terms);
    const findings: Record<number, string[]> = {};
    for (const part of T1.parts) {
      const result = await doc.write(draft_id, part.row, part.ops);
      findings[part.row] = result.ok
        ? []
        : (result.validationErrors ?? []).map(
            ({ code, path }) => `${code} ${path}`,
          );
    }
    expect(findings).toEqual({
      3: ["term /ops/1/text"],
      4: [
        "clause-numbering /ops/6/text",
        "term /ops/6/text",
        "term /ops/8/text",
      ],
      5: ["kept-unchanged /ops"],
      6: ["kept-unchanged /ops"],
      7: [
        "clause-numbering /ops/5/text",
        "clause-numbering /ops/8/text",
        "clause-numbering /ops/9/text",
        "term /ops/1/text",
      ],
    });
    const row4 = await doc.write(draft_id, 4, T1.parts[1].ops);
    expect(row4.ok ? [] : row4.validationErrors?.[0]?.message).toBe(
      'Line 1 has (1) where b158 has (5); line 2 has (2) where b159 has (6); line 3 has (3) where b160 has (7); line 4 has (4) where b161 has (8). Keep each paragraph\'s clause number as the original has it. If changing the clause numbering is intended, send the part again with allow: ["clause-numbering"].',
    );
    const allowed = partsReceipt(
      await doc.write(draft_id, 4, T1.parts[1].ops, undefined, [
        "term",
        "clause-numbering",
        "numbers",
      ]),
    );
    expect(allowed.allowed).toEqual(["clause-numbering", "term"]);
    expect(
      partsRejection(
        await doc.write(draft_id, 4, T1.parts[1].ops, undefined, ["all"]),
      )?.validationErrors,
    ).toEqual([
      {
        path: "/allow",
        code: "part-shape",
        message:
          'allow lists checks whose change is intended: "numbers", "clause-numbering", "term", "kept-unchanged" and "cross-reference". Use it only when a check\'s error says so.',
      },
    ]);
  });

  it("holds the parts to every term the section plan lists, also in otherwise faithful text", async () => {
    const { doc, draft_id } = await planned([...TERMS, "Avis"]);
    expect(
      partsRejection(
        await doc.write(
          draft_id,
          ROW[6],
          probeOps(doc.snapshot, 6, PROBE.parts["C-T1-V4-sol-t1__S6"].after),
        ),
      )?.validationErrors,
    ).toEqual([
      expect.objectContaining({
        code: "term",
        message: expect.stringMatching(/^Line 3 drops Avis, which b148 has\./),
      }),
    ]);
  });
});

/** A small English contract: the rules come from the document, so no language needs a table. */
describe("code checks in an English document", () => {
  const snapshot = sectionSnapshot([
    {
      type: "heading",
      level: 1,
      styleRef: "Heading1",
      text: "Section 1 Scope",
    },
    { type: "paragraph", text: "(1) The Supplier delivers the Goods." },
    {
      type: "heading",
      level: 1,
      styleRef: "Heading1",
      text: "Section 2 Payment",
    },
    {
      type: "paragraph",
      text: "(1) The Customer pays EUR 1,200 per month within 30 days.",
    },
    {
      type: "paragraph",
      text: "(2) Late payment accrues interest of 5 percent.",
    },
    { type: "heading", level: 1, styleRef: "Heading1", text: "Section 3 Term" },
    { type: "paragraph", text: "(1) The contract runs for 2 years." },
  ]);
  const plan = parseWordPartsPlan(
    {
      intent: "Plain English; Section 3 moves before Section 2.",
      terms: ["Customer"],
      rows: [
        { source: "b1-b2", action: "keep" },
        { source: "b6-b7", action: "keep" },
        { source: "b3-b5", action: "rewrite", change: "Plain English." },
      ],
    },
    snapshot,
  );
  if (!("plan" in plan)) throw new Error(JSON.stringify(plan.issues));
  const write = (
    ops: unknown[],
    allow: WordPartAllow[] = [],
    rows = plan.plan.rows,
  ) => {
    const sections = { ...plan.plan, rows };
    const r = rows.findIndex((row) => row.action === "rewrite");
    const parsed = parseWordPartOps(ops, r, rows[r], snapshot);
    if (!("ops" in parsed)) throw new Error(JSON.stringify(parsed.issues));
    const parts = new Map([[r, parsed.ops]]);
    const assembly = assembleWordParts(snapshot, "token", sections, parts);
    return {
      part: checkWordPart({
        snapshot,
        plan: sections,
        row: r,
        ops: parsed.ops,
        assembly,
        allow: new Set(allow),
      }),
      references: wordPartsReferenceIssues(
        snapshot,
        sections,
        parts,
        new Map([[r, new Set(allow)]]),
        assembly,
      ),
    };
  };

  it("checks numbers, clause numbers and terms", () => {
    const { part } = write([
      { keep: "b3" },
      {
        replace: "b4-b5",
        text: "(1) You pay EUR 1,500 each month within 30 days.\n(3) If you pay late, you owe 5 percent interest.",
      },
    ]);
    expect(part.issues.map(({ code, message }) => [code, message])).toEqual([
      [
        "numbers",
        'Line 1 has 1,500 where b4 has 1,200. Keep every number and amount as the original writes it. If changing this number is intended, send the part again with allow: ["numbers"].',
      ],
      [
        "clause-numbering",
        'Line 2 has (3) where b5 has (2). Keep each paragraph\'s clause number as the original has it. If changing the clause numbering is intended, send the part again with allow: ["clause-numbering"].',
      ],
      [
        "term",
        'Line 1 drops Customer, which b4 has. Keep the section plan\'s terms as the document writes them. If changing this term is intended, send the part again with allow: ["term"].',
      ],
    ]);
    expect(
      write(
        [
          { keep: "b3" },
          {
            replace: "b4-b5",
            text: "(1) The Customer pays EUR 1,500 each month within 30 days.\n(2) If the Customer pays late, 5 percent interest accrues.",
          },
        ],
        ["numbers"],
      ).part,
    ).toEqual({ issues: [], waived: ["numbers"] });
    expect(
      write([
        { keep: "b3" },
        {
          replace: "b4-b5",
          text: "(1) The Customer pays EUR 1,500 each month within 40 days.\n(2) If the Customer pays late, 5 percent interest accrues.",
        },
      ]).part.issues.map(({ message }) => message),
    ).toEqual([
      'Line 1 has 1,500 and 40 where b4 has 1,200 and 30. Keep every number and amount as the original writes it. If changing these numbers is intended, send the part again with allow: ["numbers"].',
    ]);
  });

  it("refuses a new reference to a moved section, and a repeat without new formatting", () => {
    const { part, references } = write([
      { keep: "b3" },
      {
        replace: "b4-b5",
        text: "(1) The Customer pays EUR 1,200 per month within 30 days, as Section 3 sets out.\n(2) **Late** payment accrues interest of 5 percent.",
      },
    ]);
    expect(part.issues).toEqual([]);
    expect(references.issues).toEqual([
      expect.objectContaining({
        code: "cross-reference",
        path: "/ops/1/text",
        line: 1,
        message: expect.stringMatching(
          /^Adds a reference to Section 3 Term, which this change moves/,
        ),
      }),
    ]);
    expect(
      write([
        { keep: "b3" },
        {
          replace: "b4-b5",
          text: "(1) The Customer pays EUR 1,200 each month within 30 days.\n(2) Late payment accrues interest of 5 percent.",
        },
      ]).part.issues,
    ).toEqual([
      expect.objectContaining({
        code: "row-scope",
        message: expect.stringMatching(/^Line 2 repeats b5 word for word\./),
      }),
    ]);
  });

  it("refuses references to a deleted section and old numbers of a renumbered one", () => {
    const rewrite = {
      action: "rewrite" as const,
      refs: ["b3", "b4", "b5"],
      change: "Plain English.",
    };
    const ops = [
      { keep: "b3-b4" },
      {
        replace: "b5",
        text: "(2) Late payment accrues interest of 5 percent; Section 3 applies.",
      },
    ];
    expect(
      write(
        ops,
        [],
        [
          { action: "keep", refs: ["b1", "b2"] },
          rewrite,
          { action: "delete", refs: ["b6", "b7"], reason: "Obsolete." },
        ],
      ).references.issues[0].message,
    ).toBe(
      "Refers to Section 3 Term, which this change deletes; leave the reference out.",
    );
    expect(
      write(
        ops,
        [],
        [
          { action: "keep", refs: ["b1", "b2"] },
          rewrite,
          { action: "keep", refs: ["b6", "b7"], title: "Section 4 Term" },
        ],
      ).references.issues[0].message,
    ).toBe(
      "Refers to Section 3 Term, which this change renumbers to Section 4; use Section 4.",
    );
  });

  it("finds the sections a request names by number or full title", () => {
    expect(
      wordPartsUncoveredSections(
        snapshot,
        plan.plan,
        "Rewrite Section 2 in plain English and move Section 3 before it.",
      ),
    ).toEqual([]);
    const keep = (...sources: string[]) => ({
      ...plan.plan,
      rows: sources.map((source) => ({
        action: "keep" as const,
        refs: wordPartRefs(source, snapshot) as string[],
      })),
    });
    expect(
      wordPartsUncoveredSections(
        snapshot,
        keep("b1-b2", "b3-b5", "b6-b7"),
        "Rewrite Section 1 and Section 2.",
      ).map(({ title }) => title),
    ).toEqual(["Section 1 Scope", "Section 2 Payment"]);
    expect(
      wordPartsUncoveredSections(
        snapshot,
        keep("b1-b2", "b6-b7", "b3-b5"),
        "Swap Section 2 and Section 3.",
      ),
    ).toEqual([]);
  });

  it("counts a moved section as moved whatever its size, and a swap on both sides", () => {
    const sections = (count: number, long: number) =>
      sectionSnapshot(
        Array.from({ length: count }, (_, k) => [
          {
            type: "heading" as const,
            level: 1,
            styleRef: "Heading1",
            text: `Section ${k + 1} Part ${k + 1}`,
          },
          ...Array.from({ length: k === long ? 10 : 1 }, (_, n) => ({
            type: "paragraph" as const,
            text: `Text ${n + 1} of part ${k + 1}.`,
          })),
        ]).flat(),
      );
    const doc = sections(5, 1);
    const rowsOf = (...sections: number[]) => {
      const starts = doc.blocks.flatMap((b, k) =>
        b.type === "heading" ? [k] : [],
      );
      return {
        intent: "Order.",
        terms: [],
        rows: sections.map((n) => ({
          action: "keep" as const,
          refs: doc.blocks
            .slice(starts[n - 1], starts[n] ?? doc.blocks.length)
            .map((b) => b.ref),
        })),
      };
    };
    expect(
      wordPartsUncoveredSections(
        doc,
        rowsOf(1, 3, 4, 5, 2),
        "Move Section 2 to the end.",
      ),
    ).toEqual([]);
    expect(
      wordPartsUncoveredSections(
        doc,
        rowsOf(1, 4, 3, 2, 5),
        "Swap Section 2 and Section 4; Section 3 stays.",
      ).map(({ title }) => title),
    ).toEqual(["Section 3 Part 3"]);
  });
});

/** References the original text already makes, across a delete, a swap with new numbers and a
 * shift after a merge. */
describe("references at finish", () => {
  const snapshot = sectionSnapshot([
    {
      type: "heading",
      level: 1,
      styleRef: "Heading1",
      text: "Section 1 Scope",
    },
    {
      type: "paragraph",
      text: "(1) The Supplier delivers the Goods under Section 3 and Section 4.",
    },
    { type: "heading", level: 1, styleRef: "Heading1", text: "Section 2 Fees" },
    { type: "paragraph", text: "(1) The fee is EUR 1,200 per month." },
    { type: "heading", level: 1, styleRef: "Heading1", text: "Section 3 Term" },
    { type: "paragraph", text: "(1) The contract runs for 2 years." },
    {
      type: "heading",
      level: 1,
      styleRef: "Heading1",
      text: "Section 4 Notice",
    },
    { type: "paragraph", text: "(1) Notice is due 3 months ahead." },
  ]);
  const rewrite = {
    action: "rewrite" as const,
    refs: ["b1", "b2"],
    change: "Plain English.",
  };
  const found = (
    rows: WordPartRow[],
    text: string,
  ): { line?: number; message: string }[] => {
    const sections = { intent: "Order.", terms: [], rows: [rewrite, ...rows] };
    const parsed = parseWordPartOps(
      [{ keep: "b1" }, { replace: "b2", text }],
      0,
      rewrite,
      snapshot,
    );
    if (!("ops" in parsed)) throw new Error(JSON.stringify(parsed.issues));
    const parts = new Map([[0, parsed.ops]]);
    const assembly = assembleWordParts(snapshot, "token", sections, parts);
    expect(
      checkWordPart({
        snapshot,
        plan: sections,
        row: 0,
        ops: parsed.ops,
        assembly,
        allow: new Set(),
      }).issues,
    ).toEqual([]);
    return wordPartsReferenceIssues(
      snapshot,
      sections,
      parts,
      new Map(),
      assembly,
    ).issues.map(({ message }) => ({ message }));
  };
  const keep = (refs: string[], title?: string): WordPartRow => ({
    action: "keep",
    refs,
    ...(title ? { title } : {}),
  });

  it("refuses a kept reference to a section the change deletes", () => {
    expect(
      found(
        [
          keep(["b3", "b4"]),
          { action: "delete", refs: ["b5", "b6"], reason: "Obsolete." },
          keep(["b7", "b8"]),
        ],
        "(1) The Supplier delivers the Goods as Section 3 and Section 4 say.",
      ),
    ).toEqual([
      {
        message:
          "Refers to Section 3 Term, which this change deletes; leave the reference out.",
      },
    ]);
  });

  it("refuses old numbers in a swap with new numbers, and takes the new ones", () => {
    const swapped = [
      keep(["b5", "b6"], "Section 2 Term"),
      keep(["b3", "b4"], "Section 3 Fees"),
      keep(["b7", "b8"]),
    ];
    expect(
      found(
        swapped,
        "(1) The Supplier delivers the Goods as Section 3 and Section 4 say.",
      ),
    ).toEqual([
      {
        message:
          "Refers to Section 3 Term, which this change renumbers to Section 2; use Section 2.",
      },
    ]);
    expect(
      found(
        swapped,
        "(1) The Supplier delivers the Goods as Section 2 and Section 4 say.",
      ),
    ).toEqual([]);
  });

  it("refuses old numbers after a merge shifts the sections, and takes the new ones", () => {
    const merged = [
      keep(["b3", "b4"]),
      {
        action: "delete" as const,
        refs: ["b5"],
        reason: "Merged into Section 2.",
      },
      keep(["b6"]),
      keep(["b7", "b8"], "Section 3 Notice"),
    ];
    expect(
      found(
        merged,
        "(1) The Supplier delivers the Goods as Section 3 and Section 4 say.",
      ),
    ).toEqual([
      {
        message:
          "Refers to Section 3 Term, whose heading this change deletes; refer to the section that now holds its text, or leave the reference out.",
      },
      {
        message:
          "Refers to Section 4 Notice, which this change renumbers to Section 3; use Section 3.",
      },
    ]);
    expect(
      found(
        merged,
        "(1) The Supplier delivers the Goods as Section 2 and Section 3 say.",
      ),
    ).toEqual([]);
  });

  it("has no section numbers where Word numbers the headings itself", () => {
    const numbered = sectionSnapshot(
      ["Scope", "Fees", "Term"].flatMap((title): SectionBlock[] => [
        {
          type: "list-item",
          list: "7",
          ordered: true,
          level: 0,
          outlineLevel: 1,
          styleRef: "Heading1",
          text: title,
        },
        { type: "paragraph", text: `The ${title.toLowerCase()} applies.` },
      ]),
    );
    expect(wordSectionLabels(numbered)).toEqual([]);
  });

  it("refuses a new reference to either side of a swap", () => {
    expect(
      found(
        [keep(["b7", "b8"]), keep(["b5", "b6"]), keep(["b3", "b4"])],
        "(1) The Supplier delivers the Goods as Section 3 and Section 4 say, for the fee in Section 2.",
      ),
    ).toEqual([
      {
        message: expect.stringMatching(
          /^Adds a reference to Section 2 Fees, which this change moves/,
        ),
      },
    ]);
  });

  it("takes a kept reference across a move", () => {
    expect(
      found(
        [keep(["b5", "b6"]), keep(["b3", "b4"]), keep(["b7", "b8"])],
        "(1) The Supplier delivers the Goods as Section 3 and Section 4 say.",
      ),
    ).toEqual([]);
  });
});

/** One rewrite row over a few blocks, the way the read shows them. */
describe("part checks on lists, runs and merges", () => {
  const issues = (blocks: SectionBlock[], ops: unknown[]) => {
    const snapshot = sectionSnapshot(blocks);
    const row: WordPartRow = {
      action: "rewrite",
      refs: snapshot.blocks.map((b) => b.ref),
      change: "Plain English.",
    };
    const plan = { intent: "Plain English.", terms: [], rows: [row] };
    const parsed = parseWordPartOps(ops, 0, row, snapshot);
    if (!("ops" in parsed)) throw new Error(JSON.stringify(parsed.issues));
    const assembly = assembleWordParts(
      snapshot,
      "token",
      plan,
      new Map([[0, parsed.ops]]),
    );
    return checkWordPart({
      snapshot,
      plan,
      row: 0,
      ops: parsed.ops,
      assembly,
      allow: new Set(),
    }).issues.map(({ code, message }) => `${code}: ${message}`);
  };
  const title: SectionBlock = {
    type: "heading",
    level: 1,
    styleRef: "Heading1",
    text: "Section 1 Duties",
  };
  const item = (text: string): SectionBlock => ({
    type: "list-item",
    list: "1",
    level: 0,
    text,
  });

  it("reads a clause number after a tab, as the read shows it", () => {
    expect(
      issues(
        [
          title,
          { type: "paragraph", text: "\t(1) The fee is due within 30 days." },
        ],
        [
          { keep: "b1" },
          { replace: "b2", text: "(1) You pay the fee within 30 days." },
        ],
      ),
    ).toEqual([]);
  });

  it("takes a list turned into a numbered one as a change, and a retyped one as a repeat", () => {
    const blocks = [
      title,
      { type: "paragraph" as const, text: "The Supplier must:" },
      item("deliver on time"),
      item("pack safely"),
    ];
    expect(
      issues(blocks, [
        { keep: "b1" },
        { replace: "b2", text: "The Supplier does the following:" },
        { replace: "b3-b4", text: "1. deliver on time\n2. pack safely" },
      ]),
    ).toEqual([]);
    expect(
      issues(blocks, [
        { keep: "b1" },
        { replace: "b2", text: "The Supplier does the following:" },
        { replace: "b3-b4", text: "- deliver on time\n- pack safely" },
      ]),
    ).toEqual([
      expect.stringMatching(
        /^row-scope: Lines 1–2 repeat b3-b4 word for word\./,
      ),
      expect.stringMatching(
        /^kept-unchanged: This part leaves 2 of the row's 3 body paragraphs unchanged\./,
      ),
    ]);
  });

  it("finds a repeat where Word split a bold span", () => {
    expect(
      issues(
        [
          title,
          {
            type: "paragraph",
            text: "(2) Late payment accrues interest of 5 percent.",
            runs: [
              { text: "(2) " },
              { text: "Late ", bold: true },
              { text: "payment", bold: true, color: "000000" },
              { text: " accrues interest of 5 percent." },
            ],
          },
          { type: "paragraph", text: "(3) Invoices are sent monthly." },
        ],
        [
          { keep: "b1" },
          {
            replace: "b2-b3",
            text: "(2) **Late payment** accrues interest of 5 percent.\n(3) We send invoices each month.",
          },
        ],
      ),
    ).toEqual([
      expect.stringMatching(/^row-scope: Line 1 repeats b2 word for word\./),
    ]);
  });

  it("counts list items among the paragraphs a row leaves unchanged", () => {
    const items = ["one", "two", "three", "four", "five", "six"].map((n) =>
      item(`Duty ${n}.`),
    );
    expect(
      issues(
        [
          title,
          { type: "paragraph", text: "The Supplier must:" },
          ...items.slice(0, 4),
        ],
        [
          { keep: "b1-b2" },
          {
            replace: "b3-b6",
            text: "- Do one.\n- Do two.\n- Do three.\n- Do four.",
          },
        ],
      ),
    ).toEqual([]);
    expect(
      issues(
        [title, ...items],
        [
          { keep: "b1-b5" },
          { replace: "b6", text: "- Do five." },
          { keep: "b7" },
        ],
      ),
    ).toEqual([
      expect.stringMatching(
        /^kept-unchanged: This part leaves 5 of the row's 6 body paragraphs unchanged \(kept: b2-b5,b7\)\./,
      ),
    ]);
  });

  it("takes the numbers of a paragraph merged into another", () => {
    expect(
      issues(
        [
          title,
          { type: "paragraph", text: "(1) The fee of EUR 1,200 is due." },
          { type: "paragraph", text: "(2) It is due within 30 days." },
        ],
        [
          { keep: "b1" },
          {
            replace: "b2",
            text: "(1) The fee of EUR 1,200 is due within 30 days.",
          },
          { delete: "b3", reason: "Merged into (1)." },
        ],
      ),
    ).toEqual([]);
  });
});
