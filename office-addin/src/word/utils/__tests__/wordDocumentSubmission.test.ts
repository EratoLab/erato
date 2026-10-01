import {
  acceptedWordPlanFromHistory,
  parseWordDocumentPlan,
} from "@erato/frontend/word-review";
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  readySnapshot,
  examplePlan,
} from "../../../test/mocks/word/authoringFixtures";
import { buildWordArtifact } from "../buildWordArtifact";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import {
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
    snapshot.used = true;
    expect(await submit(plan, context)).toEqual(result);
    expect(
      await submit(plan, { ...context, toolCallId: "after-apply" }),
    ).toMatchObject({ ok: false });
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
    expect(
      await submit(corrected, { ...context, toolCallId: "corrected-table" }),
    ).toMatchObject({ ok: true });
    expect(parseWordDocumentPlan(JSON.stringify(corrected))?.deleted).toEqual(
      [],
    );
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
      acceptedWordPlanFromHistory([withPart({ status: "error" })]),
    ).toBeUndefined();
    expect(
      acceptedWordPlanFromHistory([
        withPart({ output: { status: "success", result: result.result } }),
      ]),
    ).toBeUndefined();
    expect(
      acceptedWordPlanFromHistory([
        withPart({
          output: {
            status: "success",
            result: { ...(result.result as object), draft_id: "other" },
            submission: { status: "accepted" },
          },
        }),
      ]),
    ).toBeUndefined();
    expect(acceptedWordPlanFromHistory([part, part])).toBeUndefined();
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

describe("Word draft repairs", () => {
  async function rejected() {
    const fixture = await setup();
    const { deleted: _, ...incomplete } = fixture.plan;
    const failure = await fixture.submit(incomplete, context);
    if (failure.ok || !failure.submissionFeedback?.draft)
      throw new Error("Expected repair handle");
    return {
      ...fixture,
      incomplete,
      failure,
      repair: {
        snapshot: fixture.snapshot.token,
        readToken: fixture.snapshot.readToken,
        draft_id: failure.submissionFeedback.draft.id,
        revision: failure.submissionFeedback.draft.revision,
        patches: [{ op: "add", path: "/deleted", value: fixture.plan.deleted }],
      },
    };
  }

  it("names omitted refs without echoing the document or proposal", async () => {
    const { failure } = await rejected();
    expect(failure.validationErrors).toEqual([
      {
        path: "/entries",
        code: "source-coverage",
        message: expect.stringContaining("Unaccounted body sources: b3."),
      },
    ]);
    expect(JSON.stringify(failure)).not.toContain("Two regions.");
  });

  it("identifies both occurrences of a duplicated captured reference", async () => {
    const { submit, plan } = await setup();
    plan.entries.push({ kind: "keep", source: ["b1"] });
    const result = await submit(plan, context);
    expect(result).toMatchObject({
      ok: false,
      validationErrors: [
        {
          path: "/entries/5/source/0",
          code: "source-ownership",
          message: expect.stringContaining(
            "b1 is already consumed at /entries/2/source/0",
          ),
        },
      ],
    });
  });

  it("accepts a small repair and restores the complete review plan after session cleanup", async () => {
    const { submit, session, plan, repair } = await rejected();
    expect(JSON.stringify(repair).length).toBeLessThan(
      JSON.stringify(plan).length,
    );
    const repairContext = { ...context, toolCallId: "repair" };
    const accepted = await submit(repair, repairContext);
    expect(accepted).toMatchObject({
      ok: true,
      result: { draft_id: "repair", plan },
    });
    expect(await submit(repair, repairContext)).toEqual(accepted);
    if (!accepted.ok) throw new Error("Expected accepted repair");
    const content = JSON.parse(
      JSON.stringify([
        {
          content_type: "tool_use",
          tool_name: WORD_SUBMIT_PLAN_TOOL,
          tool_call_id: "repair",
          input: repair,
          status: "success",
          output: {
            status: "success",
            result: accepted.result,
            submission: { status: "accepted", attempts_remaining: 0 },
          },
        },
      ]),
    ) as ContentPart[];
    session.clear();
    expect(acceptedWordPlanFromHistory(content)).toMatchObject({
      toolCallId: "repair",
      content: JSON.stringify(plan),
    });
    const artifact = buildWordArtifact({
      facetId: "word_document_authoring",
      clientActionInfo: {
        clientActions: ["word.apply_document_plan"],
        alwaysAskActions: [],
        presentation: "auto_prompt",
      },
      content,
      messageId: context.messageId,
      capture: undefined,
    });
    expect(artifact?.submittedCard?.content).toBe(JSON.stringify(plan));
    const output = (
      content[0] as Extract<ContentPart, { content_type: "tool_use" }>
    ).output as unknown as { result: { plan?: unknown } };
    delete output.result.plan;
    expect(acceptedWordPlanFromHistory(content)).toBeUndefined();
  });

  it("distinguishes transport redelivery from a new unchanged proposal", async () => {
    const { submit, incomplete, failure } = await rejected();
    expect(await submit(incomplete, context)).toEqual(failure);
    const reordered = Object.fromEntries(Object.entries(incomplete).reverse());
    expect(
      await submit(reordered, { ...context, toolCallId: "repeated" }),
    ).toMatchObject({
      ok: false,
      submissionFeedback: { terminal: true, draft: { revision: 1 } },
      validationErrors: [{ code: "no-progress" }, { code: "source-coverage" }],
    });
  });

  it("coalesces simultaneous delivery of the same rejected submission", async () => {
    const { submit, plan } = await setup();
    const { deleted: _, ...incomplete } = plan;
    const [first, duplicate] = await Promise.all([
      submit(incomplete, context),
      submit(incomplete, context),
    ]);
    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      ok: false,
      submissionFeedback: { terminal: false, draft: { revision: 1 } },
    });
  });

  it("advances changed rejected drafts once and rejects stale repairs", async () => {
    const { submit, repair } = await rejected();
    const changed = {
      ...repair,
      patches: [
        {
          op: "replace",
          path: "/entries/1/blocks/0/styleRef",
          value: "unknown",
        },
      ],
    };
    // add creates a previously absent property; replace requires it to exist.
    changed.patches[0].op = "add";
    const next = await submit(changed, { ...context, toolCallId: "change" });
    expect(next).toMatchObject({
      ok: false,
      submissionFeedback: { draft: { revision: 2 }, terminal: false },
    });
    expect(await submit(changed, { ...context, toolCallId: "change" })).toEqual(
      next,
    );
    expect(
      await submit(repair, { ...context, toolCallId: "stale" }),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "draft-revision" }],
    });
    expect(
      await submit(
        {
          ...repair,
          revision: 2,
          patches: [
            { op: "remove", path: "/entries/1/blocks/0/styleRef" },
            ...repair.patches,
          ],
        },
        { ...context, toolCallId: "fixed" },
      ),
    ).toMatchObject({ ok: true });
  });

  it("applies malformed patch batches atomically", async () => {
    const { submit, repair, plan } = await rejected();
    const bad = {
      ...repair,
      patches: [
        { op: "remove", path: "/entries/0" },
        { op: "remove", path: "/entries/999" },
      ],
    };
    const failed = await submit(bad, { ...context, toolCallId: "bad-patch" });
    expect(failed).toMatchObject({
      ok: false,
      validationErrors: [{ path: "/patches/1", code: "repair-patch" }],
    });
    expect(
      await submit(repair, { ...context, toolCallId: "fixed" }),
    ).toMatchObject({ ok: true, result: { plan } });
    expect(await submit(bad, { ...context, toolCallId: "bad-patch" })).toEqual(
      failed,
    );
  });

  it("binds repairs to their original chat, message, snapshot and completed read", async () => {
    const { submit, session, repair } = await rejected();
    for (const wrong of [
      { ...context, chatId: "other" },
      { ...context, messageId: "other" },
    ])
      expect(await submit(repair, wrong)).toMatchObject({ ok: false });
    expect(
      await submit(
        { ...repair, snapshot: "other" },
        { ...context, toolCallId: "wrong" },
      ),
    ).toMatchObject({ ok: false });
    expect(
      await submit(
        { ...repair, readToken: "other" },
        { ...context, toolCallId: "wrong-token" },
      ),
    ).toMatchObject({ ok: false });
    session.clear();
    expect(
      await submit(repair, { ...context, toolCallId: "expired" }),
    ).toMatchObject({ ok: false });
  });

  it("does not retain a cancelled proposal or reuse a call ID with different arguments", async () => {
    const { submit, incomplete, repair } = await rejected();
    expect(await submit(repair, context)).toMatchObject({
      ok: false,
      validationErrors: [{ code: "call-conflict" }],
    });
    const controller = new AbortController();
    const pending = submit(incomplete, {
      ...context,
      toolCallId: "cancelled",
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toMatchObject({
      ok: false,
      error: "Document submission stopped.",
    });
    expect(
      await submit(repair, { ...context, toolCallId: "still-current" }),
    ).toMatchObject({ ok: true });
  });
});
