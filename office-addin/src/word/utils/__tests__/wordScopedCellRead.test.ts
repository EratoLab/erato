import { afterEach, describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import {
  resolveWordActionFacet,
  WORD_AUTHORING_FACET_ID,
} from "../wordActionFacet";
import { applyWordDocumentPlan } from "../wordApplyDocumentPlan";
import {
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "../wordDocumentPlan";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type { WordDocumentPlan } from "../wordDocumentPlan";

const context = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "call-A",
};
const rich =
  '<w:p><w:pPr><w:jc w:val="right"/><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>18</w:t></w:r></w:p>';
const table = (target = rich) =>
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
  [
    [paragraph("Team"), paragraph("Hours")],
    [paragraph("East"), paragraph("18")],
    [paragraph("West"), target],
  ]
    .map(
      (row) =>
        "<w:tr>" +
        row.map((cell) => "<w:tc><w:tcPr/>" + cell + "</w:tc>").join("") +
        "</w:tr>",
    )
    .join("") +
  "</w:tbl>";
function setup(
  body = paragraph("Quarterly allocation") + table() + paragraph("After"),
) {
  const snapshot = readySnapshot(packageXml(body));
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const read = (table_cell: Record<string, unknown>, extra = {}) =>
    session.execute(
      {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        table_cell,
        ...extra,
      },
      context,
    );
  return {
    snapshot,
    session,
    read,
    submit: createWordDocumentSubmissionExecutor(session),
  };
}
async function ready(state: ReturnType<typeof setup>) {
  const response = await state.read({ header: "hours", rowLabel: "west" });
  expect(response).toMatchObject({
    ok: true,
    result: { status: "ready", totalMatches: 1 },
  });
  if (!response.ok) throw new Error(response.error);
  const result = response.result as {
    snapshot: string;
    readToken: string;
    target: Record<string, unknown>;
  };
  return {
    snapshot: result.snapshot,
    readToken: result.readToken,
    table_cell: { ...result.target, text: "21" },
  };
}
async function accepted(state: ReturnType<typeof setup>) {
  const input = await ready(state);
  const result = await state.submit(input, {
    ...context,
    toolCallId: "submit",
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const plan = parseWordDocumentPlan(
    JSON.stringify((result.result as { plan: unknown }).plan),
  )!;
  return { plan, input, result };
}
afterEach(() => vi.unstubAllGlobals());
describe("bounded table-cell reads", () => {
  it("authorizes the discovered cell and preserves native properties and all surrounding content", async () => {
    const state = setup();
    const { snapshot } = state;
    const original = snapshot.ooxml;
    const { plan, input, result } = await accepted(state);
    expect(snapshot.read.size).toBe(0);
    expect(snapshot.readToken).toBeUndefined();
    expect(
      validateWordDocumentPlan({ ...plan, readToken: "invented" }, snapshot),
    ).toBe("incomplete");
    expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
    const compiled = compileWordDocumentPlan(plan, snapshot);
    const output = captureWordAuthoringSnapshot(
      compiled,
      snapshot.identity,
      "Off",
    );
    expect(verifyWordPlanOutput(plan, snapshot, output)).toBe(true);
    expect(output.blocks[0].xml).toBe(snapshot.blocks[0].xml);
    expect(output.blocks[2].xml).toBe(snapshot.blocks[2].xml);
    const cells = new DOMParser()
      .parseFromString(compiled, "application/xml")
      .getElementsByTagNameNS(W, "tc");
    const before = new DOMParser()
      .parseFromString(original, "application/xml")
      .getElementsByTagNameNS(W, "tc");
    for (let n = 0; n < 5; n++)
      expect(cells[n].isEqualNode(before[n])).toBe(true);
    expect(cells[5].textContent).toBe("21");
    for (const property of ["pPr", "rPr", "tcPr"])
      expect(
        cells[5]
          .getElementsByTagNameNS(W, property)[0]
          .isEqualNode(before[5].getElementsByTagNameNS(W, property)[0]),
      ).toBe(true);
    expect(snapshot.ooxml).toBe(original);
    snapshot.used = true;
    expect(
      await state.submit(input, { ...context, toolCallId: "submit" }),
    ).toEqual(result);
    expect(
      (await state.submit(input, { ...context, toolCallId: "new-call" })).ok,
    ).toBe(false);
  });
  it("pages ambiguous candidates without authorization, then resolves by context or exact references", async () => {
    const state = setup(
      Array.from(
        { length: 7 },
        (_, i) => paragraph(`Allocation ${i}`) + table() + paragraph("End"),
      ).join(""),
    );
    const query = { header: "Hours", rowLabel: "West" };
    const ambiguous = await state.read(query);
    expect(ambiguous).toMatchObject({
      ok: true,
      result: { status: "ambiguous", totalMatches: 7, nextOffset: 5 },
    });
    expect(ambiguous).not.toHaveProperty("result.readToken");
    expect(state.snapshot.cellReads?.size).toBe(0);
    const next = await state.read({ ...query, offset: 5 });
    expect(next).toMatchObject({
      ok: true,
      result: { status: "ambiguous", nextOffset: null },
    });
    if (!next.ok) throw new Error(next.error);
    const candidates = (
      next.result as { candidates: Record<string, unknown>[] }
    ).candidates;
    expect(candidates).toHaveLength(2);
    const last = candidates[1];
    expect(
      await state.read({
        sourceRef: last.sourceRef,
        rowIndex: last.rowIndex,
        cellIndex: last.cellIndex,
      }),
    ).toMatchObject({ ok: true, result: { status: "ready" } });
    expect(
      await state.read({ ...query, nearbyText: "Allocation 3" }),
    ).toMatchObject({
      ok: true,
      result: { status: "ready", target: { sourceRef: "b11" } },
    });
    expect(await state.read({ rowLabel: "absent" })).toMatchObject({
      ok: true,
      result: { status: "not-found", totalMatches: 0 },
    });
  });
  it.each([10, 100, 1000])(
    "keeps initial/tool context bounded with %i unrelated paragraphs",
    async (count) => {
      const state = setup(
        paragraph("Allocation") +
          table() +
          paragraph("End") +
          Array.from({ length: count }, (_, i) =>
            paragraph(`Unrelated private filler ${i}.`),
          ).join(""),
      );
      const facet = resolveWordActionFacet({
        chipEnabled: true,
        documentName: "sample.docx",
        documentIdentity: "doc-A",
        documentArgs: {
          document_text: "Unrelated private filler ".repeat(count),
          heading_outline: "UNSEEN HEADINGS",
          paragraphs_sent: String(count),
          paragraphs_total: String(count),
          truncation_note: "",
        },
        hasContent: true,
        authoring: state.snapshot,
        availableFacetIds: new Set([WORD_AUTHORING_FACET_ID]),
      });
      expect(facet?.args).toMatchObject({
        document_text: "",
        heading_outline: "",
        paragraphs_sent: "0",
        document_snapshot: state.snapshot.token,
      });
      const response = await state.read({ header: "Hours", rowLabel: "West" });
      expect(
        new TextEncoder().encode(JSON.stringify(response)).length,
      ).toBeLessThan(6000);
      expect(JSON.stringify(response)).not.toContain(
        "Unrelated private filler",
      );
      expect(response).not.toHaveProperty("result.blocks");
      expect((await state.submit(await ready(state), context)).ok).toBe(true);
      expect(state.snapshot.read.size).toBe(0);
    },
  );
  it.each(["snapshot", "documentIdentity"])(
    "rejects wrong-document %s without refreshing old references",
    async (field) => {
      const state = setup();
      expect(
        await state.read(
          { header: "Hours", rowLabel: "West" },
          { [field]: "other-document" },
        ),
      ).toMatchObject({
        ok: false,
        validationErrors: [{ code: "snapshot-mismatch" }],
      });
      expect(state.snapshot.cellReads?.size).toBe(0);
    },
  );
  it.each([
    "revoked",
    "used",
    "owner",
    "identity",
    "fingerprint",
    "new-capture",
  ])("rejects stale scoped authorization: %s", async (change) => {
    const state = setup();
    const input = await ready(state);
    if (change === "revoked") state.snapshot.revoked = true;
    if (change === "used") state.snapshot.used = true;
    if (change === "identity") state.snapshot.identity = "other";
    if (change === "fingerprint") state.snapshot.fingerprint += "changed";
    if (change === "new-capture")
      state.session.activate(readySnapshot(state.snapshot.ooxml), context);
    expect(
      (
        await state.submit(input, {
          ...context,
          ...(change === "owner" ? { messageId: "other" } : {}),
        })
      ).ok,
    ).toBe(false);
  });
  it("rejects other targets, full plans, repairs and tampered materialized plans", async () => {
    const state = setup();
    const input = await ready(state);
    for (const patch of [
      { rowIndex: 1 },
      { cellIndex: 0 },
      { sourceRef: "b999" },
      { expectedText: "wrong" },
    ])
      expect(
        await state.submit(
          { ...input, table_cell: { ...input.table_cell, ...patch } },
          { ...context, toolCallId: JSON.stringify(patch) },
        ),
      ).toMatchObject({
        ok: false,
        validationErrors: [{ code: "outside-read-scope" }],
      });
    const { plan } = await accepted(state);
    expect(
      (await state.submit(plan, { ...context, toolCallId: "full" })).ok,
    ).toBe(false);
    expect(
      (
        await state.submit(
          {
            snapshot: input.snapshot,
            readToken: input.readToken,
            draft_id: "invented",
            revision: 1,
            patches: [],
          },
          { ...context, toolCallId: "repair" },
        )
      ).ok,
    ).toBe(false);
    for (const mutate of [
      (p: WordDocumentPlan) => p.entries.reverse(),
      (p: WordDocumentPlan) => p.entries.splice(0, 1),
      (p: WordDocumentPlan) => {
        p.stories = [];
        p.scope = "document";
      },
      (p: WordDocumentPlan) => {
        const e = p.entries[1];
        if (e.kind === "replace" && e.blocks[0].type === "table")
          e.blocks[0].rows[1].cells[1].textEdit = {
            expectedText: "18",
            text: "999",
          };
      },
      (p: WordDocumentPlan) => {
        const e = p.entries[1];
        if (e.kind === "replace" && e.blocks[0].type === "table")
          e.blocks[0].format = { shading: "FFFFFF" };
      },
    ]) {
      const changed = JSON.parse(JSON.stringify(plan)) as WordDocumentPlan;
      mutate(changed);
      expect(validateWordDocumentPlan(changed, state.snapshot)).not.toBeNull();
    }
  });
  it.each([
    paragraph("18") + paragraph("extra"),
    "<w:p><w:hyperlink><w:r><w:t>18</w:t></w:r></w:hyperlink></w:p>",
    "<w:p><w:r><w:t>1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>8</w:t></w:r></w:p>",
    paragraph("x".repeat(4097)),
  ])(
    "falls back for unsupported cells without granting scope",
    async (target) => {
      const state = setup(
        paragraph("Before") + table(target) + paragraph("After"),
      );
      expect(
        await state.read({ header: "Hours", rowLabel: "West" }),
      ).toMatchObject({
        ok: true,
        result: { status: "unsupported", fallback: "complete-read" },
      });
      expect(state.snapshot.cellReads?.size).toBe(0);
      expect(
        (
          await state.session.execute(
            { snapshot: state.snapshot.token },
            context,
          )
        ).ok,
      ).toBe(true);
      expect(state.snapshot.readToken).toBeTruthy();
      expect(
        (
          await state.submit(
            {
              version: 1,
              snapshot: state.snapshot.token,
              readToken: state.snapshot.readToken,
              scope: "body",
              entries: state.snapshot.blocks.map((b) => ({
                kind: "keep",
                source: [b.ref],
              })),
            },
            context,
          )
        ).ok,
      ).toBe(true);
    },
  );
  it("rejects merged tables and bounds escaped snippets", async () => {
    const state = setup(
      paragraph('"'.repeat(1000)) +
        table().replace(
          "<w:tcPr/>",
          '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
        ),
    );
    const response = await state.read({ header: "Hours", rowLabel: "West" });
    expect(response).toMatchObject({
      ok: true,
      result: { status: "unsupported" },
    });
    expect(JSON.stringify(response).length).toBeLessThan(6000);
    expect(JSON.stringify(response)).not.toContain("structureJson");
  });
  it("retains live stale-document detection before any Office.js write", async () => {
    const state = setup();
    const { plan } = await accepted(state);
    const insert = vi.fn();
    vi.stubGlobal("Word", {
      run: async (callback: (c: unknown) => Promise<unknown>) =>
        callback({
          document: {
            load: vi.fn(),
            changeTrackingMode: "Off",
            body: {
              getOoxml: () => ({
                value: state.snapshot.ooxml.replace(
                  "After",
                  "Changed outside cell",
                ),
              }),
              insertOoxml: insert,
            },
          },
          sync: async () => {},
        }),
    });
    expect(
      await applyWordDocumentPlan(
        JSON.stringify(plan),
        state.snapshot,
        context.messageId,
      ),
    ).toMatchObject({
      status: "stale",
      diagnostic: { reason: "source-changed" },
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
