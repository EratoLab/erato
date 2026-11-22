import { readFileSync } from "node:fs";

import {
  acceptedWordPlanFromHistory,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  WORD_SUBMIT_PLAN_TOOL,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openWordParts,
  partsReceipt,
  partsRejection,
  WORD_PARTS_FIXTURES,
} from "../../../test/mocks/word/wordPartsTurn";
import { finishWordParts, wordPartsFinishRejected } from "../wordDocumentParts";

import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentPlan } from "@erato/frontend/word-review";

/** The probe's T1 parts (qwen3.8-max), one section plan row per part. */
const T1_RAW = JSON.parse(
  readFileSync(`${WORD_PARTS_FIXTURES}/t1-parts.json`, "utf8"),
) as {
  plan: { intent: string; terms: string[]; rows: Record<string, string>[] };
  parts: { row: number; ops: Record<string, string>[] }[];
};
/** What the code checks find in the T1 writer's parts, sent as intended so these tests exercise
 * the pipeline; wordPartChecks.test.ts sends them as they are. */
const T1_ALLOW: Record<number, string[]> = {
  3: ["term"],
  4: ["clause-numbering", "term"],
  5: ["kept-unchanged"],
  6: ["kept-unchanged"],
  7: ["clause-numbering", "term"],
};
const T1 = {
  plan: T1_RAW.plan,
  parts: T1_RAW.parts.map((part) => ({ ...part, allow: T1_ALLOW[part.row] })),
};
const ALL_CHECKS = ["numbers", "clause-numbering", "term", "kept-unchanged"];

const open = openWordParts;
const receipt = partsReceipt;
const rejection = partsRejection;

// Every call runs the shipping compile and verification on a 422-block document.
describe("a large change in parts", { timeout: 30_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("replays the probe's whole restructure (T1) into one accepted, valid plan", async () => {
    const doc = await open();
    const planned = receipt(await doc.plan(T1.plan));
    expect(planned.rows.map((row) => [row.title, row.status])).toEqual([
      ["Rahmenliefervertrag RV-2026-117 – § 3 Leistungsumfang", "kept"],
      ["§ 7 Preise und Zahlungsbedingungen", "kept"],
      ["§ 5 Bestellungen und Abrufe", "waiting"],
      ["§ 6 Lieferung und Logistik", "waiting"],
      ["§ 12 Notfall- und Eskalationsmanagement", "waiting"],
      ["§ 8 Qualitätssicherung – § 10 Haftung", "waiting"],
      ["§ 11 Datenschutz und Informationssicherheit", "waiting"],
      ["§ 13 Laufzeit, Kündigung und Schlussbestimmungen", "kept"],
    ]);
    let { draft_id, revision } = planned;
    for (const part of T1.parts) {
      const written = receipt(
        await doc.write(draft_id, part.row, part.ops, undefined, part.allow),
      );
      expect(written).toMatchObject({ row: part.row, status: "ready" });
      ({ draft_id, revision } = written);
    }
    const finished = await doc.finish(draft_id, revision);
    expect(finished.ok).toBe(true);
    const result = (finished as { result: Record<string, unknown> }).result;
    expect(result).toMatchObject({
      action: "word.apply_document_plan",
      snapshot: doc.snapshot.token,
    });
    expect(result.notInProposal).toBeUndefined();
    const plan = parseWordDocumentPlan(JSON.stringify(result.plan))!;
    expect(validateWordDocumentPlan(plan, doc.snapshot)).toBeNull();
    const order = plan.entries.flatMap((e) =>
      e.kind === "keep" ? e.source : [],
    );
    expect(order.indexOf("b179")).toBeLessThan(order.indexOf("b99"));
    expect(order.indexOf("b350")).toBeLessThan(order.indexOf("b215"));
    const table = plan.entries
      .flatMap((e) => (e.kind === "keep" ? [] : e.blocks))
      .find((block) => block.type === "table");
    expect(table).toMatchObject({
      format: { firstRow: true },
      rows: expect.arrayContaining([
        expect.objectContaining({ format: { repeatHeader: true } }),
      ]),
    });
    expect(table?.type === "table" && table.rows).toHaveLength(6);
    // The document's Table Grid gives a header row no look of its own.
    expect(table).toMatchObject({ format: { styleRef: "TableGrid" } });
    const header = table?.type === "table" ? table.rows[0].cells : [];
    expect(
      header.flatMap((cell) =>
        (cell.blocks ?? []).flatMap((block) => block.runs ?? []),
      ),
    ).toEqual(header.map(() => expect.objectContaining({ bold: true })));

    const part = {
      content_type: "tool_use",
      tool_call_id: "finish",
      tool_name: WORD_SUBMIT_PLAN_TOOL,
      status: "success",
      input: {
        snapshot: doc.snapshot.token,
        readToken: doc.readToken,
        draft_id,
        revision,
        finish: true,
      },
      output: {
        status: "success",
        submission: { status: "accepted" },
        result: { ...result, draft_id: "finish" },
      },
    } as unknown as ContentPart;
    expect(acceptedWordPlanFromHistory([part])?.plan).toEqual(plan);
  });

  it("names the line of a broken table row and keeps the draft as it was", async () => {
    const doc = await open();
    const { draft_id, revision } = receipt(await doc.plan(T1.plan));
    const ops = [
      { keep: "b350-b353" },
      {
        replace: "b354-b358",
        text: "| Stufe | Zuständig | Reaktionszeit | Aufgabe |\n|---|---|---|---|\n| Stufe 1 | Schichtleitung | 2 Stunden |",
      },
      { keep: "b359-b380" },
    ];
    expect(rejection(await doc.write(draft_id, 5, ops))).toMatchObject({
      validationErrors: [
        {
          path: "/ops/1/text",
          code: "text-form",
          message:
            "Line 3: this table row has 3 cells, but the table's first row (line 1) has 4; give every row of a table the same number of cells, leaving a cell empty as | |.",
        },
      ],
      submissionFeedback: { terminal: false, recovery: "repair_arguments" },
    });
    const finish = rejection(await doc.finish(draft_id, revision));
    expect(finish?.validationErrors?.[0]).toMatchObject({
      code: "rows-not-written",
    });
  });

  it("points the shipping validator's errors into the part, with the line", async () => {
    const doc = await open();
    const { draft_id } = receipt(await doc.plan(T1.plan));
    expect(
      rejection(
        await doc.write(
          draft_id,
          5,
          [
            { keep: "b350-b353" },
            { replace: "b354-b358", text: "Gut.\nStufe \u0007 eins" },
            { keep: "b359-b380" },
          ],
          undefined,
          ALL_CHECKS,
        ),
      )?.validationErrors,
    ).toEqual([
      {
        path: "/ops/1/text",
        code: "paragraph-shape",
        message:
          "Line 2: Text blocks require text without newlines or control characters.",
      },
    ]);
    expect(
      rejection(
        await doc.write(draft_id, 5, [
          { keep: "b350-b353" },
          { replace: "b354-b358", text: "Neu." },
        ]),
      )?.validationErrors,
    ).toEqual([
      {
        path: "/ops",
        code: "source-coverage",
        message:
          "Row 5's blocks b359-b380 are in no op; keep, replace or delete each block of the row exactly once.",
      },
    ]);
    expect(
      rejection(await doc.write(draft_id, 5, [{ keep: "b349-b380" }]))
        ?.validationErrors?.[0],
    ).toMatchObject({ path: "/ops/0/keep", code: "source-ownership" });
    expect(
      rejection(
        await doc.write(draft_id, 5, [
          { keep: "b350-b353" },
          { keep: "b359-b380" },
          { replace: "b354-b358", text: "Neu." },
        ]),
      )?.validationErrors,
    ).toEqual([
      {
        path: "/ops/1/keep",
        code: "source-order",
        message:
          "b359 is out of order; the ops use row 5's blocks in the order of its source, b350-b380. To move blocks, change the row order in the section plan.",
      },
    ]);
    expect(
      rejection(await doc.write(draft_id, 1, [{ keep: "b1-b98" }]))
        ?.validationErrors?.[0],
    ).toMatchObject({ path: "/row", code: "row-action" });
  });

  it("stops the part that takes the whole change over the plan limit", async () => {
    const doc = await open();
    const { draft_id } = receipt(await doc.plan(T1.plan));
    expect(
      rejection(
        await doc.write(
          draft_id,
          5,
          [{ replace: "b350-b380", text: "Lang. ".repeat(50_000) }],
          undefined,
          ALL_CHECKS,
        ),
      )?.validationErrors,
    ).toEqual([
      {
        path: "",
        code: "too-large",
        message:
          "With this part, the whole change exceeds the 256 KiB plan limit; keep more blocks by reference, or leave part of the change for the next request.",
      },
    ]);
  });

  it("checks the section plan's rows and asks for the complete read first", async () => {
    const doc = await open();
    const rows = T1.plan.rows;
    expect(
      rejection(
        await doc.plan({
          ...T1.plan,
          rows: [...rows.slice(0, -1), { source: "b381-b421", action: "keep" }],
        }),
      )?.validationErrors,
    ).toEqual([
      {
        path: "/rows",
        code: "source-coverage",
        message:
          "Blocks in no row: b422. Every body block belongs to exactly one keep, rewrite or delete row.",
      },
    ]);
    expect(
      rejection(
        await doc.plan({
          ...T1.plan,
          rows: [...rows, { source: "b5", action: "delete", reason: "x" }],
        }),
      )?.validationErrors?.[0],
    ).toMatchObject({ path: "/rows/8/source", code: "source-ownership" });
    expect(
      rejection(await doc.plan({ ...T1.plan, readToken: "stale" })),
    ).toMatchObject({
      validationErrors: [{ path: "/readToken", code: "incomplete-read" }],
      submissionFeedback: { recovery: "read_current_context" },
    });
  });

  it("refuses rows without a part once, then leaves them as they are and names them", async () => {
    const doc = await open();
    let { draft_id, revision } = receipt(await doc.plan(T1.plan));
    for (const part of T1.parts.slice(0, -1))
      ({ draft_id, revision } = receipt(
        await doc.write(draft_id, part.row, part.ops, undefined, part.allow),
      ));
    expect(
      rejection(await doc.finish(draft_id, revision - 1))
        ?.validationErrors?.[0],
    ).toMatchObject({ path: "/revision", code: "draft-revision" });
    expect(
      rejection(await doc.finish(draft_id, revision))?.validationErrors,
    ).toEqual([
      {
        path: "/finish",
        code: "rows-not-written",
        message: `Row 7 (§ 11 Datenschutz und Informationssicherheit) has no part yet. Write it with write_document_section and finish again, or finish again at revision ${revision} to leave it unchanged; the card then says so.`,
      },
    ]);
    const finished = await doc.finish(draft_id, revision);
    expect(finished.ok).toBe(true);
    const result = (finished as { result: Record<string, unknown> }).result;
    expect(result.notInProposal).toEqual([
      "§ 11 Datenschutz und Informationssicherheit",
    ]);
    expect(result.rows).toContainEqual(
      expect.objectContaining({ row: 7, status: "not_written" }),
    );
    const plan = result.plan as WordDocumentPlan;
    expect(
      plan.entries.some((e) => e.kind === "keep" && e.source.includes("b309")),
    ).toBe(true);
  });

  it("names the row of a refused finish, ends the step on the same refusal and takes a new part as progress", async () => {
    const doc = await open();
    let { draft_id, revision } = receipt(await doc.plan(T1.plan));
    for (const part of T1.parts)
      ({ draft_id, revision } = receipt(
        await doc.write(draft_id, part.row, part.ops, undefined, part.allow),
      ));
    const input = {
      snapshot: doc.snapshot.token,
      readToken: doc.readToken,
      draft_id,
      revision,
      finish: true,
    };
    const finish = finishWordParts(
      input,
      doc.snapshot,
      doc.session.drafts.parts,
    );
    if (!finish.ok) throw new Error("fixture");
    const entry = finish.assembly.entries.findIndex(
      (origin) =>
        origin.row === 4 && "op" in origin && origin.field === "replace",
    );
    expect(
      wordPartsFinishRejected(
        {
          ok: false,
          error: "Document plan validation failed.",
          validationErrors: [
            {
              path: `/entries/${entry}/blocks/0/text`,
              code: "numbers",
              message: "A deadline changed.",
            },
          ],
        },
        finish,
        doc.snapshot,
      ),
    ).toMatchObject({
      validationErrors: [
        {
          path: "",
          code: "numbers",
          message:
            "Row 5 (§ 12 Notfall- und Eskalationsmanagement), at /ops/1/text line 1: A deadline changed. Send row 5 again with write_document_section.",
        },
      ],
    });

    doc.snapshot.trackingMode = "TrackAll";
    const refused = rejection(await doc.finish(draft_id, revision));
    expect(refused?.validationErrors?.[0]).toMatchObject({
      code: "tracking-needs-import",
      message: expect.stringMatching(/^The section plan and its parts: /),
    });
    expect(refused?.submissionFeedback?.terminal).toBe(false);
    expect(rejection(await doc.finish(draft_id, revision))).toMatchObject({
      validationErrors: [
        { code: "no-progress" },
        { code: "tracking-needs-import" },
      ],
      submissionFeedback: { terminal: true },
    });

    doc.snapshot.trackingMode = "Off";
    ({ revision } = receipt(
      await doc.write(
        draft_id,
        5,
        T1.parts[2].ops,
        undefined,
        T1.parts[2].allow,
      ),
    ));
    doc.snapshot.trackingMode = "TrackAll";
    expect(
      rejection(await doc.finish(draft_id, revision))?.submissionFeedback
        ?.terminal,
    ).toBe(false);
  });

  it("names the rows a section plan announced when a smaller change is accepted instead", async () => {
    const doc = await open();
    receipt(await doc.plan(T1.plan));
    const accepted = await doc.submit({
      scoped_edit: {
        body: [
          {
            operation: "replace",
            source: ["b101"],
            blocks: [{ id: "n1", type: "paragraph", text: "Neu." }],
          },
        ],
      },
    });
    expect(accepted.ok).toBe(true);
    const result = (accepted as { result: Record<string, unknown> }).result;
    expect(result.notInProposal).toEqual(
      expect.arrayContaining([
        "§ 6 Lieferung und Logistik",
        "§ 12 Notfall- und Eskalationsmanagement",
        "§ 11 Datenschutz und Informationssicherheit",
      ]),
    );
    expect(result.notInProposalNote).toMatch(
      /which the section plan of this request announced\./,
    );
  });

  it("checks parts that overlap one after the other", async () => {
    const doc = await open();
    const { draft_id } = receipt(await doc.plan(T1.plan));
    const [first, second] = await Promise.all(
      T1.parts
        .slice(0, 2)
        .map((part) =>
          doc.write(draft_id, part.row, part.ops, undefined, part.allow),
        ),
    );
    expect([receipt(first).revision, receipt(second).revision]).toEqual([2, 3]);
    expect(receipt(second).rows_left).toEqual([5, 6, 7]);
  });

  it("refuses on arrival a part that Word for the web could only write by replacing the whole document", async () => {
    vi.stubGlobal("Office", {
      context: {
        diagnostics: { platform: "OfficeOnline" },
        requirements: { isSetSupported: () => true },
        document: { getFileAsync: () => undefined },
      },
    });
    const doc = await open();
    expect(
      rejection(await doc.plan(T1.plan))?.validationErrors?.[0],
    ).toMatchObject({ code: "web-needs-whole-document" });
    const { draft_id } = receipt(
      await doc.plan({
        ...T1.plan,
        rows: [
          { source: "b1-b100", action: "keep" },
          { source: "b101", action: "rewrite", change: "As a list." },
          { source: "b102-b422", action: "keep" },
        ],
      }),
    );
    expect(
      rejection(
        await doc.write(
          draft_id,
          2,
          [{ replace: "b101", text: "- eins\n- zwei" }],
          undefined,
          ALL_CHECKS,
        ),
      )?.validationErrors?.[0],
    ).toMatchObject({ code: "web-needs-whole-document" });
  });

  it("says a pane without this request's read cannot write a part", async () => {
    const doc = await open();
    const { draft_id } = receipt(await doc.plan(T1.plan));
    expect(
      await doc.write(draft_id, 3, T1.parts[0].ops, {
        chatId: "chat-B",
        messageId: "message-B",
        toolCallId: "other",
      }),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/snapshot", code: "wrong-request" }],
      submissionFeedback: { terminal: true, recovery: "cannot_continue" },
    });
  });

  it("renames only the heading a keep row starts with", async () => {
    const doc = await open();
    const rows = [
      { source: "b1-b100", action: "keep" },
      { source: "b101-b178", action: "keep", title: "Neuer Titel" },
      { source: "b179-b422", action: "keep" },
    ];
    expect(
      rejection(await doc.plan({ ...T1.plan, rows }))?.validationErrors,
    ).toEqual([
      {
        path: "/rows/1/title",
        code: "row-shape",
        message:
          "title renames the heading a keep row starts with, and this row starts with other text; start the row at its heading, or rewrite the row.",
      },
    ]);
  });

  it("keeps the parts of unchanged rows when the section plan is sent again", async () => {
    const doc = await open();
    let { draft_id } = receipt(await doc.plan(T1.plan));
    ({ draft_id } = receipt(
      await doc.write(
        draft_id,
        3,
        T1.parts[0].ops,
        undefined,
        T1.parts[0].allow,
      ),
    ));
    const rows = T1.plan.rows.map((row, k) =>
      k === 3 ? { source: row.source, action: "keep" } : row,
    );
    const again = receipt(await doc.plan({ ...T1.plan, rows }));
    expect(again.draft_id).toBe(draft_id);
    expect(again.rows.map((row) => row.status)).toEqual([
      "kept",
      "kept",
      "ready",
      "kept",
      "waiting",
      "waiting",
      "waiting",
      "kept",
    ]);
  });

  it("renames a kept heading by title", async () => {
    const doc = await open();
    const rows = T1.plan.rows.map((row, k) =>
      k === 1 ? { ...row, title: "§ 4 Preise und Zahlungsbedingungen" } : row,
    );
    const planned = receipt(
      await doc.plan({
        ...T1.plan,
        rows: rows
          .map((row) =>
            row.action === "rewrite" ? { ...row, action: "keep" } : row,
          )
          .map(({ change: _change, ...row }) => row),
      }),
    );
    expect(planned.rows[1]).toMatchObject({
      title: "§ 7 Preise und Zahlungsbedingungen",
      new_title: "§ 4 Preise und Zahlungsbedingungen",
    });
    const finished = await doc.finish(planned.draft_id, planned.revision);
    const plan = (finished as { result: { plan: WordDocumentPlan } }).result
      .plan;
    expect(plan.entries).toContainEqual({
      kind: "replace",
      source: ["b179"],
      blocks: [
        expect.objectContaining({
          type: "heading",
          level: 1,
          text: "§ 4 Preise und Zahlungsbedingungen",
        }),
      ],
    });
  });
});
