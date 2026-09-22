import { describe, expect, it, vi, afterEach } from "vitest";

import {
  readySnapshot,
  examplePlan,
} from "../../../test/mocks/word/authoringFixtures";
import { buildWordArtifact } from "../buildWordArtifact";
import { parseWordDocumentPlan } from "../wordDocumentPlan";
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

const context: ClientToolCallContext = {
  toolCallId: "submit-A",
  messageId: "message-A",
  chatId: "chat-A",
};

async function setup() {
  const session = new WordDocumentReadSession();
  const snapshot = readySnapshot();
  session.activate(snapshot, context);
  await session.execute(
    { snapshot: snapshot.token },
    { ...context, toolCallId: "read-A" },
  );
  const plan = examplePlan(snapshot.token);
  plan.readToken = snapshot.readToken!;
  return {
    session,
    snapshot,
    plan,
    submit: createWordDocumentSubmissionExecutor(session),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("structured Word submissions", () => {
  it("stages a deterministic receipt without entering the Word write host", async () => {
    const { submit, snapshot, plan } = await setup();
    const run = vi.fn(() => {
      throw new Error("Submission must not call Office.js");
    });
    vi.stubGlobal("Word", { run });
    const result = await submit(plan, context);
    expect(result).toEqual({
      ok: true,
      result: {
        draft_id: "submit-A",
        snapshot: snapshot.token,
        action: "word.apply_document_plan",
      },
    });
    expect(await submit(plan, context)).toEqual(result);
    expect(snapshot.used).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("corrects a bad style using the parser's path, then accepts the same draft", async () => {
    const { submit, plan } = await setup();
    const entry = plan.entries[1];
    if (entry.kind !== "replace") throw new Error("fixture");
    entry.blocks[0].styleRef = "invented-style";
    const failed = await submit(plan, context);
    expect(failed).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/entries/1/blocks/0/styleRef", code: "paragraph-style" },
      ],
    });
    expect(JSON.stringify(failed)).not.toContain(entry.blocks[0].text);
    entry.blocks[0].styleRef = "Normal";
    expect(
      await submit(plan, { ...context, toolCallId: "corrected" }),
    ).toMatchObject({ ok: true });
  });

  it("pinpoints source indexes on a new table and accepts a corrected table", async () => {
    const { submit, snapshot } = await setup();
    const table = {
      id: "table",
      type: "table",
      format: { width: "auto" },
      rows: [
        {
          sourceIndex: 0,
          cells: [
            { blocks: [{ id: "cell", type: "paragraph", text: "Summary" }] },
          ],
        },
      ],
    };
    const plan = {
      version: 1,
      snapshot: snapshot.token,
      readToken: snapshot.readToken,
      scope: "body",
      entries: [
        {
          kind: "replace",
          source: snapshot.blocks.map((b) => b.ref),
          blocks: [table],
        },
      ],
    };
    const failed = await submit(plan, context);
    expect(failed).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/entries/0/blocks/0/rows/0", code: "table-row" },
      ],
    });
    const { sourceIndex: _, ...newRow } = table.rows[0];
    const corrected = {
      ...plan,
      entries: [{ ...plan.entries[0], blocks: [{ ...table, rows: [newRow] }] }],
    };
    expect(await submit(corrected, context)).toMatchObject({ ok: true });
    expect(parseWordDocumentPlan(JSON.stringify(corrected))?.deleted).toEqual(
      [],
    );
    // Normalization does not alter the persisted tool arguments.
    expect(corrected).not.toHaveProperty("deleted");
  });

  it("does not turn omitted deleted into an implicit deletion", async () => {
    const { submit, plan } = await setup();
    const { deleted: _, ...incomplete } = plan;
    expect(await submit(incomplete, context)).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/entries", code: "source-coverage" }],
    });
  });

  it("pinpoints nested duplicate output IDs", async () => {
    const { submit, plan } = await setup();
    plan.entries.push({
      kind: "insert",
      blocks: [
        {
          id: "table",
          type: "table",
          text: "",
          rows: [
            {
              cells: [
                {
                  blocks: [{ id: "n1", type: "paragraph", text: "Duplicate" }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [
        {
          path: "/entries/5/blocks/0/rows/0/cells/0/blocks/0/id",
          code: "duplicate-id",
        },
      ],
    });
  });

  it("rejects malformed arguments and reports the nested run location", async () => {
    const { submit, plan } = await setup();
    expect(await submit("not a plan", context)).toMatchObject({ ok: false });
    const entry = plan.entries[1];
    if (entry.kind !== "replace") throw new Error("fixture");
    entry.blocks[0].runs = [{ text: "different" }];
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [
        { path: "/entries/1/blocks/0/runs", code: "runs-shape" },
      ],
    });
  });

  it("requires the originating chat, message, completed read, and active snapshot", async () => {
    const { session, snapshot, submit, plan } = await setup();
    for (const wrong of [
      { ...context, messageId: "different" },
      { ...context, chatId: "different" },
    ])
      expect(await submit(plan, wrong)).toMatchObject({
        ok: false,
        validationErrors: [{ code: "wrong-request" }],
      });
    snapshot.read.delete("b1");
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "incomplete-read" }],
    });
    snapshot.read.add("b1");
    snapshot.used = true;
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "expired" }],
    });
    snapshot.used = false;
    session.clear();
    expect(await submit(plan, context)).toMatchObject({ ok: false });
  });

  it("does not stage a cancelled submission", async () => {
    const { submit, plan } = await setup();
    expect(
      await submit(plan, { ...context, signal: AbortSignal.abort() }),
    ).toMatchObject({ ok: false });
  });

  it("checks compilation before accepting structurally valid duplicate bookmarks", async () => {
    const { submit, plan } = await setup();
    plan.entries.push({
      kind: "insert",
      blocks: [1, 2].map((i) => ({
        id: `bookmark-${i}`,
        type: "bookmark",
        text: "",
        bookmark: {
          name: "Repeated",
          children: [{ id: `child-${i}`, type: "paragraph", text: "Content" }],
        },
      })),
    });
    expect(await submit(plan, context)).toMatchObject({
      ok: false,
      validationErrors: [
        {
          code: "compile-plan",
          message:
            "Bookmark names must be unique across the resulting document.",
        },
      ],
    });
  });

  it("recovers the accepted card from persisted input and receipt without another proposal", async () => {
    const { submit, plan } = await setup();
    const result = await submit(plan, context);
    if (!result.ok) throw new Error("Expected accepted fixture");
    const part = {
      content_type: "tool_use",
      tool_name: WORD_SUBMIT_PLAN_TOOL,
      tool_call_id: context.toolCallId,
      input: plan,
      status: "success",
      output: {
        status: "success",
        result: result.result,
        submission: { status: "accepted", attempts_remaining: 0 },
      },
    } as unknown as Extract<ContentPart, { content_type: "tool_use" }>;
    const withPart = (overrides: Record<string, unknown>): ContentPart => ({
      ...part,
      ...overrides,
    });
    const content = JSON.parse(JSON.stringify([part])) as ContentPart[];
    const artifact = buildWordArtifact({
      facetId: "word_document_authoring",
      clientActionInfo: {
        clientActions: ["word.apply_document_plan"],
        alwaysAskActions: [],
        presentation: "auto_prompt",
      },
      content,
      messageId: "message-A",
      capture: undefined,
    });
    expect(artifact?.submittedCard).toMatchObject({
      toolCallId: "submit-A",
      language: "erato-word-document-plan",
      content: JSON.stringify(plan),
    });
    expect(artifact?.proposedClientAction).toBe("word.apply_document_plan");
    expect(artifact?.isFreshCompletion).toBeUndefined();
    expect(artifact?.itemIdentity).toBeUndefined();
    expect(
      acceptedWordDocumentSubmission([withPart({ status: "error" })]),
    ).toBeUndefined();
    expect(
      acceptedWordDocumentSubmission([
        withPart({ output: { status: "success", result: result.result } }),
      ]),
    ).toBeUndefined();
    expect(
      acceptedWordDocumentSubmission([
        withPart({
          output: {
            status: "success",
            result: { ...(result.result as object), draft_id: "other" },
            submission: { status: "accepted" },
          },
        }),
      ]),
    ).toBeUndefined();
    expect(acceptedWordDocumentSubmission([part, part])).toBeUndefined();
    expect(
      buildWordArtifact({
        facetId: "word_document_authoring",
        clientActionInfo: {
          clientActions: ["word.apply_edits"],
          alwaysAskActions: [],
        },
        content,
        messageId: "message-A",
        capture: undefined,
      })?.submittedCard,
    ).toBeUndefined();
  });
});
