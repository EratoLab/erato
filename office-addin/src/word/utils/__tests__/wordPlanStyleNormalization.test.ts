import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  validateWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  examplePlan,
  readySnapshot,
  sixParagraphXml,
} from "../../../test/mocks/word/authoringFixtures";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import {
  acceptedWordDocumentSubmission,
  createWordDocumentSubmissionExecutor,
  WORD_SUBMIT_PLAN_TOOL,
} from "../wordDocumentSubmission";

import type {
  ClientToolCallContext,
  ContentPart,
} from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanDiagnostics,
} from "@erato/frontend/word-review";

const context: ClientToolCallContext = {
  toolCallId: "submit-A",
  messageId: "message-A",
  chatId: "chat-A",
};

const withStyles = (styles: string) =>
  sixParagraphXml().replace("</w:styles>", `${styles}</w:styles>`);
const localizedStyles =
  '<w:style w:type="paragraph" w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="NormaleTabelle"><w:name w:val="Normal Table"/></w:style>';

const table = (styleRef?: string): WordPlanBlock => ({
  id: "t1",
  type: "table",
  text: "",
  ...(styleRef ? { styleRef } : {}),
  columns: [150, 300],
  rows: [
    {
      cells: [
        { blocks: [{ id: "c1", type: "paragraph", text: "Key" }] },
        { blocks: [{ id: "c2", type: "paragraph", text: "Value" }] },
      ],
    },
  ],
});

/** The rejected turn-A shape: built-in heading styles and TableNormal restated as styleRef. */
function turnAPlan(
  token: string,
  styles = { h1: "Heading1", h2: "Heading2", table: "TableNormal" },
) {
  const plan = examplePlan(token);
  const [insert, , , background] = plan.entries;
  if (insert.kind !== "insert" || background.kind !== "replace")
    throw new Error("fixture");
  insert.blocks[0].styleRef = styles.h1;
  insert.blocks.push(table(styles.table));
  background.blocks[0].styleRef = styles.h2;
  return plan;
}

async function submitter(snapshot: WordAuthoringSnapshot) {
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  await session.execute(
    { snapshot: snapshot.token },
    { ...context, toolCallId: "read-A" },
  );
  return createWordDocumentSubmissionExecutor(session);
}

const styleRefs = (plan: WordDocumentPlan) =>
  plan.entries.flatMap((entry) =>
    entry.kind === "keep"
      ? []
      : entry.blocks.map((block) => [block.id, block.styleRef]),
  );

describe("precise block diagnostics", () => {
  const issuesFor = (block: Record<string, unknown>) => {
    const plan = examplePlan("snap");
    const issues: WordPlanDiagnostics = [];
    const content = JSON.stringify({
      ...plan,
      entries: [
        { kind: "insert", blocks: [{ id: "n1", text: "T", ...block }] },
      ],
    });
    expect(parseWordDocumentPlan(content, issues)).toBeNull();
    return issues.map(({ path, code }) => ({ path, code }));
  };

  it("points at the offending heading, paragraph and list fields", () => {
    const at = (field: string) => `/entries/0/blocks/0/${field}`;
    expect(issuesFor({ type: "heading", level: 0 })).toEqual([
      { path: at("level"), code: "heading-level" },
    ]);
    expect(issuesFor({ type: "heading", level: 2, ordered: true })).toEqual([
      { path: at("ordered"), code: "heading-list" },
    ]);
    expect(issuesFor({ type: "paragraph", list: "l1" })).toEqual([
      { path: at("list"), code: "paragraph-fields" },
    ]);
    expect(issuesFor({ type: "list-item", list: "l1", level: 0 })).toEqual([
      { path: at("ordered"), code: "list-ordered" },
    ]);
    expect(issuesFor({ type: "paragraph", colour: "red" })).toEqual([
      { path: at("colour"), code: "block-key" },
    ]);
  });
});

describe("redundant styleRef normalization", () => {
  it("drops restated built-in heading and default table styles without touching the input", () => {
    const snapshot = readySnapshot();
    const plan = turnAPlan(snapshot.token);
    const before = globalThis.structuredClone(plan);
    const normalized = normalizeWordDocumentPlan(plan, snapshot);
    expect(plan).toEqual(before);
    expect(styleRefs(normalized)).toEqual([
      ["n1", undefined],
      ["t1", undefined],
      ["n2", undefined],
      ["n3", undefined],
      ["n4", undefined],
    ]);
    expect(normalizeWordDocumentPlan(normalized, snapshot)).toEqual(normalized);
    expect(validateWordDocumentPlan(normalized, snapshot)).toBeNull();
  });

  it("normalizes nested blocks inside table cells", () => {
    const snapshot = readySnapshot();
    const plan = examplePlan(snapshot.token);
    const insert = plan.entries[0];
    if (insert.kind !== "insert") throw new Error("fixture");
    const nested = table();
    if (nested.type !== "table") throw new Error("fixture");
    nested.rows[0].cells[0].blocks = [
      {
        id: "c1",
        type: "heading",
        level: 1,
        text: "Key",
        styleRef: "Heading1",
      },
    ];
    insert.blocks.push(nested);
    const normalized = normalizeWordDocumentPlan(plan, snapshot);
    const out = normalized.entries[0];
    if (out.kind !== "insert" || out.blocks[1].type !== "table")
      throw new Error("fixture");
    expect(out.blocks[1].rows[0].cells[0].blocks?.[0].styleRef).toBeUndefined();
  });

  it("resolves localized built-in styles by canonical name, not by the English ID", () => {
    const snapshot = readySnapshot(withStyles(localizedStyles));
    const localized = normalizeWordDocumentPlan(
      turnAPlan(snapshot.token, {
        h1: "Heading1",
        h2: "berschrift2",
        table: "NormaleTabelle",
      }),
      snapshot,
    );
    expect(styleRefs(localized).filter(([, style]) => style)).toEqual([]);
    const english = normalizeWordDocumentPlan(
      turnAPlan(snapshot.token),
      snapshot,
    );
    expect(styleRefs(english)).toContainEqual(["n3", "Heading2"]);
  });

  it("moves a real table style from styleRef into format.styleRef", () => {
    const snapshot = readySnapshot(
      withStyles(
        '<w:style w:type="table" w:styleId="GridTable4"><w:name w:val="Grid Table 4"/></w:style>',
      ),
    );
    const plan = turnAPlan(snapshot.token, {
      h1: "Heading1",
      h2: "Heading2",
      table: "GridTable4",
    });
    const before = globalThis.structuredClone(plan);
    const normalized = normalizeWordDocumentPlan(plan, snapshot);
    expect(plan).toEqual(before);
    const insert = normalized.entries[0];
    if (insert.kind !== "insert" || insert.blocks[1].type !== "table")
      throw new Error("fixture");
    expect(insert.blocks[1].styleRef).toBeUndefined();
    expect(insert.blocks[1].format?.styleRef).toBe("GridTable4");
    expect(normalizeWordDocumentPlan(normalized, snapshot)).toEqual(normalized);
    expect(validateWordDocumentPlan(normalized, snapshot)).toBeNull();
  });

  it("does not move a table style over an explicit format.styleRef", () => {
    const snapshot = readySnapshot(
      withStyles(
        '<w:style w:type="table" w:styleId="GridTable4"><w:name w:val="Grid Table 4"/></w:style>',
      ),
    );
    const plan = turnAPlan(snapshot.token, {
      h1: "Heading1",
      h2: "Heading2",
      table: "GridTable4",
    });
    const insert = plan.entries[0];
    if (insert.kind !== "insert" || insert.blocks[1].type !== "table")
      throw new Error("fixture");
    insert.blocks[1].format = { styleRef: "TableNormal" };
    const normalized = normalizeWordDocumentPlan(plan, snapshot);
    expect(styleRefs(normalized)).toContainEqual(["t1", "GridTable4"]);
    const issues: WordPlanDiagnostics = [];
    validateWordDocumentPlan(normalized, snapshot, issues);
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/entries/0/blocks/1/styleRef",
        code: "table-style-placement",
      }),
    );
  });

  it("keeps a heading style of another level for validation to reject", () => {
    const snapshot = readySnapshot(withStyles(localizedStyles));
    const plan = turnAPlan(snapshot.token, {
      h1: "berschrift2",
      h2: "berschrift2",
      table: "TableNormal",
    });
    expect(styleRefs(normalizeWordDocumentPlan(plan, snapshot))).toContainEqual(
      ["n1", "berschrift2"],
    );
  });
});

describe("structured submission of restated styles", () => {
  it("accepts the turn-A shape and restores the review from the unnormalized stored input", async () => {
    const snapshot = readySnapshot();
    const submit = await submitter(snapshot);
    const plan = turnAPlan(snapshot.token);
    plan.readToken = snapshot.readToken!;
    const result = await submit(plan, context);
    expect(result).toMatchObject({ ok: true });
    const part = {
      content_type: "tool_use",
      tool_name: WORD_SUBMIT_PLAN_TOOL,
      tool_call_id: "submit-A",
      status: "success",
      input: plan,
      output: {
        status: "success",
        submission: { status: "accepted" },
        result: (result as { result: unknown }).result,
      },
    } as unknown as ContentPart;
    const restored = acceptedWordDocumentSubmission([part]);
    expect(restored?.content).toBe(JSON.stringify(plan));
    const reparsed = parseWordDocumentPlan(restored!.content)!;
    expect(
      validateWordDocumentPlan(
        normalizeWordDocumentPlan(reparsed, snapshot),
        snapshot,
      ),
    ).toBeNull();
  });

  it("rejects other heading and table styles with the precise field path", async () => {
    const snapshot = readySnapshot();
    const submit = await submitter(snapshot);
    const plan = turnAPlan(snapshot.token, {
      h1: "Normal",
      h2: "Heading2",
      table: "TableNormal",
    });
    plan.readToken = snapshot.readToken!;
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/entries/0/blocks/0/styleRef", code: "heading-style" },
      ],
    });
    const tablePlan = turnAPlan(snapshot.token, {
      h1: "Heading1",
      h2: "Heading2",
      table: "Normal",
    });
    tablePlan.readToken = snapshot.readToken!;
    expect(
      await submit(tablePlan, { ...context, toolCallId: "table-style" }),
    ).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/entries/0/blocks/1/styleRef", code: "table-style-placement" },
      ],
    });
  });
});
