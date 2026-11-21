import { readFileSync } from "node:fs";

import {
  acceptedWordPlanFromHistory,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
  WORD_SUBMIT_PLAN_TOOL,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import { wordDocumentFileToOoxml } from "../wordDocumentPackage";
import { createWordDocumentPartExecutors } from "../wordDocumentPartTools";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ContentPart,
} from "@erato/frontend/library";
import type { WordDocumentPlan } from "@erato/frontend/word-review";

const FIXTURES = `${process.cwd()}/src/test/fixtures/word-parts`;
const CONTRACT = new Uint8Array(
  readFileSync(`${FIXTURES}/framework-contract.docx`),
);
/** The probe's T1 parts (qwen3.8-max), one section plan row per part. */
const T1 = JSON.parse(readFileSync(`${FIXTURES}/t1-parts.json`, "utf8")) as {
  plan: { intent: string; terms: string[]; rows: Record<string, string>[] };
  parts: { row: number; ops: Record<string, string>[] }[];
};

let calls = 0;
const context = (): ClientToolCallContext => ({
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: `call-${++calls}`,
});

async function open() {
  const snapshot = captureWordAuthoringSnapshot(
    wordDocumentFileToOoxml(CONTRACT),
    "Rahmenvertrag.docx",
    "Off",
    true,
  );
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context());
  let cursor: string | null = null;
  let readToken: string | undefined;
  do {
    const page = await session.execute(
      { snapshot: snapshot.token, cursor },
      context(),
    );
    if (!page.ok) throw new Error(page.error);
    const result = page.result as {
      nextCursor: string | null;
      readToken?: string;
    };
    cursor = result.nextCursor;
    readToken = result.readToken;
  } while (cursor);
  const parts = createWordDocumentPartExecutors(session);
  const submit = createWordDocumentSubmissionExecutor(session);
  const base = { snapshot: snapshot.token };
  return {
    snapshot,
    session,
    readToken: readToken!,
    plan: (input: Record<string, unknown>) =>
      parts.plan({ ...base, readToken, ...input }, context()),
    write: (draft: string, row: number, ops: unknown) =>
      parts.write({ ...base, draft_id: draft, row, ops }, context()),
    finish: (draft: string, revision: number, call = context()) =>
      submit(
        { ...base, readToken, draft_id: draft, revision, finish: true },
        call,
      ),
  };
}

type Receipt = {
  draft_id: string;
  revision: number;
  rows: { row: number; title: string; status: string }[];
  rows_left: number[];
};
const receipt = (result: ClientToolExecutionResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.validationErrors));
  return result.result as Receipt;
};
const rejection = (result: ClientToolExecutionResult) => {
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result;
};

// Every call runs the shipping compile and verification on a 422-block document.
describe("a large change in parts", { timeout: 30_000 }, () => {
  it("replays the probe's whole restructure (T1) into one accepted, valid plan", async () => {
    const doc = await open();
    const planned = receipt(await doc.plan(T1.plan));
    expect(planned.rows.map((row) => [row.title, row.status])).toEqual([
      ["Rahmenliefervertrag RV-2026-117", "kept"],
      ["§ 7 Preise und Zahlungsbedingungen", "kept"],
      ["§ 5 Bestellungen und Abrufe", "waiting"],
      ["§ 6 Lieferung und Logistik", "waiting"],
      ["§ 12 Notfall- und Eskalationsmanagement", "waiting"],
      ["§ 8 Qualitätssicherung", "waiting"],
      ["§ 11 Datenschutz und Informationssicherheit", "waiting"],
      ["§ 13 Laufzeit, Kündigung und Schlussbestimmungen", "kept"],
    ]);
    let { draft_id, revision } = planned;
    for (const part of T1.parts) {
      const written = receipt(await doc.write(draft_id, part.row, part.ops));
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
        await doc.write(draft_id, 5, [
          { keep: "b350-b353" },
          { replace: "b354-b358", text: "Gut.\nStufe \u0007 eins" },
          { keep: "b359-b380" },
        ]),
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
      rejection(await doc.write(draft_id, 1, [{ keep: "b1-b98" }]))
        ?.validationErrors?.[0],
    ).toMatchObject({ path: "/row", code: "row-action" });
  });

  it("stops the part that takes the whole change over the plan limit", async () => {
    const doc = await open();
    const { draft_id } = receipt(await doc.plan(T1.plan));
    expect(
      rejection(
        await doc.write(draft_id, 5, [
          { replace: "b350-b380", text: "Lang. ".repeat(50_000) },
        ]),
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
        await doc.write(draft_id, part.row, part.ops),
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

  it("keeps the parts of unchanged rows when the section plan is sent again", async () => {
    const doc = await open();
    let { draft_id } = receipt(await doc.plan(T1.plan));
    ({ draft_id } = receipt(await doc.write(draft_id, 3, T1.parts[0].ops)));
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
