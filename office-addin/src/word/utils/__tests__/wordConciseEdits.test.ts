import {
  acceptedWordPlanFromHistory,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it, vi } from "vitest";

import {
  packageXml,
  paragraph,
  readySnapshot,
  W,
} from "../../../test/mocks/word/authoringFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import {
  captureWordAuthoringSnapshot,
  compileWordDocumentPlan,
  verifyWordPlanOutput,
} from "../wordDocumentXml";

import type { ContentPart } from "@erato/frontend/library";
import type { WordDocumentPlan } from "@erato/frontend/word-review";

const context = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "submit-A",
};
const richParagraph =
  '<w:p><w:pPr><w:jc w:val="right"/><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="123456"/></w:rPr><w:t>18</w:t></w:r></w:p>';
const table = (target = richParagraph) =>
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="4800"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  [
    ["Team", "Hours"],
    ["East", "18"],
    ["West", null],
  ]
    .map(
      (row) =>
        "<w:tr>" +
        row
          .map(
            (text) =>
              '<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="2400"/></w:tcPr>' +
              (text === null ? target : paragraph(text)) +
              "</w:tc>",
          )
          .join("") +
        "</w:tr>",
    )
    .join("") +
  "</w:tbl>";

async function setup(target = richParagraph, transform = (xml: string) => xml) {
  const snapshot = readySnapshot(
    packageXml(
      paragraph("Before") + transform(table(target)) + paragraph("After"),
    ),
  );
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  await session.execute(
    { snapshot: snapshot.token },
    { ...context, toolCallId: "read-A" },
  );
  const input = {
    snapshot: snapshot.token,
    readToken: snapshot.readToken!,
    table_cell: {
      sourceRef: "b2_table_1",
      rowIndex: 2,
      cellIndex: 1,
      expectedText: "18",
      text: "21",
    },
  };
  return {
    snapshot,
    session,
    input,
    submit: createWordDocumentSubmissionExecutor(session),
  };
}

describe("concise Word table-cell submissions", () => {
  it("expands the exact target, preserves native formatting, and persists a replayable full review plan", async () => {
    const { snapshot, session, input, submit } = await setup();
    const original = snapshot.ooxml;
    const result = await submit(input, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    const plan = parseWordDocumentPlan(
      JSON.stringify((result.result as { plan: unknown }).plan),
    )!;
    expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
    const compiled = compileWordDocumentPlan(plan, snapshot);
    const output = new DOMParser().parseFromString(compiled, "application/xml");
    const cells = Array.from(output.getElementsByTagNameNS(W, "tc"));
    expect(cells.map((c) => c.textContent)).toEqual([
      "Team",
      "Hours",
      "East",
      "18",
      "West",
      "21",
    ]);
    expect(cells[5].getElementsByTagNameNS(W, "b")).toHaveLength(1);
    expect(
      cells[5].getElementsByTagNameNS(W, "color")[0].getAttributeNS(W, "val"),
    ).toBe("123456");
    expect(
      cells[5].getElementsByTagNameNS(W, "jc")[0].getAttributeNS(W, "val"),
    ).toBe("right");
    expect(cells[5].getElementsByTagNameNS(W, "keepNext")).toHaveLength(1);
    const beforeCells = Array.from(
      new DOMParser()
        .parseFromString(original, "application/xml")
        .getElementsByTagNameNS(W, "tc"),
    );
    for (let i = 0; i < 5; i++)
      expect(cells[i].isEqualNode(beforeCells[i])).toBe(true);
    expect(snapshot.ooxml).toBe(original);
    expect(
      verifyWordPlanOutput(
        plan,
        snapshot,
        captureWordAuthoringSnapshot(compiled, "doc-A", "Off"),
      ),
    ).toBe(true);
    expect(
      plan.entries.filter((e) => e.kind === "keep").flatMap((e) => e.source),
    ).toEqual(["b1", "b3"]);
    snapshot.used = true;
    expect(await submit(input, context)).toEqual(result);
    expect(
      (await submit(input, { ...context, toolCallId: "new-call" })).ok,
    ).toBe(false);
    const parts = JSON.parse(
      JSON.stringify([
        {
          content_type: "tool_use",
          tool_name: "submit_document_plan",
          tool_call_id: context.toolCallId,
          input,
          status: "success",
          output: {
            status: "success",
            result: result.result,
            submission: { status: "accepted" },
          },
        },
      ]),
    ) as ContentPart[];
    session.clear();
    expect(
      parseWordDocumentPlan(acceptedWordPlanFromHistory(parts)!.content),
    ).toEqual(plan);
    const outputResult = (
      parts[0] as unknown as { output: { result: Record<string, unknown> } }
    ).output.result;
    delete outputResult.plan;
    expect(acceptedWordPlanFromHistory(parts)).toBeUndefined();
  });

  it("preserves uniform formatting when Word splits text across runs", async () => {
    const target =
      "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>8</w:t></w:r></w:p>";
    const { submit, input } = await setup(target);
    expect((await submit(input, context)).ok).toBe(true);
  });

  it.each(["", "日本語 😀 <&>"])(
    "preserves literal replacement text %j",
    async (text) => {
      const { submit, input, snapshot } = await setup();
      input.table_cell.text = text;
      const result = await submit(input, context);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      const plan = parseWordDocumentPlan(
        JSON.stringify((result.result as { plan: unknown }).plan),
      )!;
      const doc = new DOMParser().parseFromString(
        compileWordDocumentPlan(plan, snapshot),
        "application/xml",
      );
      expect(doc.getElementsByTagNameNS(W, "tc")[5].textContent).toBe(text);
    },
  );

  it.each([
    { expectedText: "17" },
    { rowIndex: 12 },
    { cellIndex: -1 },
    { rowIndex: 1.5 },
    { sourceRef: "b999" },
    { sourceRef: "story_header_table_1" },
    { text: "line\nbreak" },
    { text: "\u0000" },
    { text: "\ud800" },
    { text: "x".repeat(10001) },
  ])(
    "rejects invalid targets and text without changing the source: %j",
    async (patch) => {
      const { submit, input, snapshot } = await setup();
      const original = snapshot.ooxml;
      const result = await submit(
        { ...input, table_cell: { ...input.table_cell, ...patch } },
        context,
      );
      expect(result).toMatchObject({
        ok: false,
        validationErrors: [
          expect.objectContaining({
            path: expect.stringContaining("/table_cell"),
          }),
        ],
      });
      expect(result).not.toHaveProperty("submissionFeedback.draft");
      expect(snapshot.ooxml).toBe(original);
    },
  );

  it.each([
    paragraph("18") + paragraph("extra"),
    "<w:p><w:hyperlink><w:r><w:t>18</w:t></w:r></w:hyperlink></w:p>",
    "<w:p><w:r><w:t>1</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>8</w:t></w:r></w:p>",
    '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>18</w:t></w:r></w:fldSimple></w:p>',
    "<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>18</w:t></w:r></w:p>",
  ])("requires a full plan for unsupported rich cells", async (target) => {
    const { submit, input } = await setup(target);
    expect(await submit(input, context)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "table-cell-content" }],
    });
  });

  it("rejects merged tables and overlapping concise/full/repair envelopes", async () => {
    const merged = await setup(richParagraph, (xml) =>
      xml.replace(
        '<w:tcW w:type="dxa" w:w="2400"/>',
        '<w:tcW w:type="dxa" w:w="2400"/><w:gridSpan w:val="2"/>',
      ),
    );
    expect((await merged.submit(merged.input, context)).ok).toBe(false);
    for (const extra of [
      { entries: [] },
      { draft_id: "draft", revision: 1, patches: [] },
    ]) {
      const { submit, input } = await setup();
      expect(await submit({ ...input, ...extra }, context)).toMatchObject({
        ok: false,
        validationErrors: [{ code: "table-cell-shape" }],
      });
    }
  });

  it("keeps read ownership, snapshot and cancellation gates", async () => {
    for (const change of [
      "unread",
      "stale",
      "used",
      "revoked",
      "wrong-owner",
      "cancelled",
    ]) {
      const { submit, input, snapshot } = await setup();
      if (change === "unread") snapshot.read.clear();
      if (change === "stale") input.snapshot = "other-snapshot";
      if (change === "used") snapshot.used = true;
      if (change === "revoked") snapshot.revoked = true;
      const result = await submit(input, {
        ...context,
        ...(change === "wrong-owner" ? { messageId: "other" } : {}),
        ...(change === "cancelled" ? { signal: AbortSignal.abort() } : {}),
      });
      expect(result.ok, change).toBe(false);
    }
  });

  it("returns actionable diagnostics and accepts a corrected concise submission", async () => {
    const { submit, input } = await setup();
    const failed = await submit(
      { ...input, table_cell: { ...input.table_cell, expectedText: "wrong" } },
      context,
    );
    expect(failed).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/table_cell/expectedText", code: "table-cell-text-mismatch" },
      ],
    });
    const wordRun = vi.fn();
    vi.stubGlobal("Word", { run: wordRun });
    try {
      expect(
        (await submit(input, { ...context, toolCallId: "corrected" })).ok,
      ).toBe(true);
      expect(wordRun).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("captured list continuation", () => {
  it.each([true, false])(
    "continues existing lists without creating numbering instances (ordered=%s)",
    (ordered) => {
      const original = readySnapshot(packageXml(paragraph("Title")));
      const seed: WordDocumentPlan = {
        version: 1,
        snapshot: original.token,
        readToken: original.readToken!,
        scope: "body",
        deleted: [],
        entries: [
          { kind: "keep", source: ["b1"] },
          {
            kind: "insert",
            blocks: ["Alpha", "Gamma"].map((text, i) => ({
              id: `list-${i}`,
              type: "list-item",
              list: "schedule",
              level: 1,
              ordered,
              text,
            })),
          },
        ],
      };
      const numbered = new DOMParser().parseFromString(
        compileWordDocumentPlan(seed, original),
        "application/xml",
      );
      const numbering = numbered.getElementsByTagNameNS(W, "num")[0];
      const override = numbered.createElementNS(W, "w:lvlOverride");
      override.setAttributeNS(W, "w:ilvl", "1");
      const start = numbered.createElementNS(W, "w:startOverride");
      start.setAttributeNS(W, "w:val", "7");
      override.append(start);
      numbering.append(override);
      const snapshot = readySnapshot(
        new XMLSerializer().serializeToString(numbered),
      );
      const plan: WordDocumentPlan = {
        ...seed,
        snapshot: snapshot.token,
        entries: [
          { kind: "keep", source: ["b1", "b2"] },
          {
            kind: "insert",
            blocks: [
              {
                id: "beta",
                type: "list-item",
                list: snapshot.blocks[1].list,
                level: 1,
                ordered,
                text: "Beta",
              },
            ],
          },
          { kind: "keep", source: ["b3"] },
        ],
      };
      expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
      const xml = compileWordDocumentPlan(plan, snapshot);
      const after = captureWordAuthoringSnapshot(xml, "doc-A", "Off");
      expect(
        after.blocks.slice(1).map((b) => [b.text, b.list, b.level]),
      ).toEqual(
        ["Alpha", "Beta", "Gamma"].map((text) => [
          text,
          snapshot.blocks[1].list,
          1,
        ]),
      );
      expect(
        new DOMParser()
          .parseFromString(xml, "application/xml")
          .getElementsByTagNameNS(W, "num"),
      ).toHaveLength(1);
      expect(verifyWordPlanOutput(plan, snapshot, after)).toBe(true);
      expect(
        new DOMParser()
          .parseFromString(xml, "application/xml")
          .getElementsByTagNameNS(W, "num")[0]
          .isEqualNode(numbering),
      ).toBe(true);
      const entry = plan.entries[1];
      if (entry.kind !== "insert") throw new Error("fixture");
      entry.blocks[0].list = "existing-999";
      expect(validateWordDocumentPlan(plan, snapshot)).toBe("invalid");
      entry.blocks[0].list = snapshot.blocks[1].list;
      entry.blocks[0].ordered = !ordered;
      expect(validateWordDocumentPlan(plan, snapshot)).toBe("invalid");
      entry.blocks[0].list = "new-schedule";
      expect(validateWordDocumentPlan(plan, snapshot)).toBeNull();
      const restarted = compileWordDocumentPlan(plan, snapshot);
      expect(
        new DOMParser()
          .parseFromString(restarted, "application/xml")
          .getElementsByTagNameNS(W, "num"),
      ).toHaveLength(2);
    },
  );
});
