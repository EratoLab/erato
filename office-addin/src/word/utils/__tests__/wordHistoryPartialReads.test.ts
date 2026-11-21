import {
  buildWordPlanReview,
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
  wordHistoryProposal,
} from "@erato/frontend/word-review";
import { describe, expect, it } from "vitest";

import {
  body,
  chapter,
  readContext,
  sectionPackageXml,
} from "../../../test/mocks/word/sectionFixtures";
import { wordDocumentOutlineText } from "../wordDocumentOutline";
import { WordDocumentReadSession } from "../wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../wordDocumentXml";

import type { SectionBlock } from "../../../test/mocks/word/sectionFixtures";
import type { ContentPart, Message } from "@erato/frontend/library";
import type {
  WordAuthoringSnapshot,
  WordPlanReview,
} from "@erato/frontend/word-review";

const blocks: SectionBlock[] = [
  body("Master Services Agreement"),
  ...[47, 40, 30, 30, 30, 30].flatMap((kib, k) => chapter(k + 1, kib)),
];

const stored = (
  toolName: string,
  toolCallId: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
) =>
  JSON.parse(
    JSON.stringify({
      content_type: "tool_use",
      tool_name: toolName,
      tool_call_id: toolCallId,
      status: "success",
      input,
      output,
    }),
  ) as ContentPart;

/** A turn on a document too large for a complete read, stored as chat history stores it. */
async function largeDocumentTurn() {
  const snapshot = captureWordAuthoringSnapshot(
    sectionPackageXml(blocks),
    "doc-A",
    "Off",
  );
  expect(snapshot.completeReadIssue).toBe("too-large");
  const session = new WordDocumentReadSession();
  session.activate(snapshot, readContext);
  const reads: ContentPart[] = [];
  const read = async (extra: Record<string, unknown>) => {
    const input = {
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      ...extra,
    };
    const toolCallId = `read-${reads.length + 1}`;
    const response = await session.execute(input, {
      ...readContext,
      toolCallId,
    });
    if (!response.ok) throw new Error(response.error);
    reads.push(
      stored(WORD_READ_TOOL, toolCallId, input, {
        status: "success",
        result: response.result,
      }),
    );
    return response.result as Record<string, unknown>;
  };
  const after = (title: string) =>
    snapshot.blocks[snapshot.blocks.findIndex((b) => b.text === title) + 1];
  const heading = snapshot.blocks.find((b) => b.text === "2.1 Section 2.1")!;
  let cursor: unknown = null;
  do
    cursor = (
      await read({
        section: { ref: heading.ref, ...(cursor ? { cursor } : {}) },
      })
    ).nextCursor;
  while (cursor);
  const changed = [
    after("2.1 Section 2.1"),
    after("4.2 Section 4.2"),
    after("6.3 Section 6.3"),
  ];
  const { readToken } = await read({
    target: { refs: changed.map((b) => b.ref) },
  });
  const input = {
    snapshot: snapshot.token,
    readToken,
    scoped_edit: {
      body: changed.map((b, k) => ({
        operation: "replace",
        source: [b.ref],
        blocks: [{ id: `n${k}`, type: "paragraph", text: `Revised ${k}.` }],
      })),
    },
  };
  const submitted = await createWordDocumentSubmissionExecutor(session)(input, {
    ...readContext,
    toolCallId: "submit-1",
  });
  if (!submitted.ok) throw new Error(submitted.error);
  const submission = stored(WORD_SUBMIT_PLAN_TOOL, "submit-1", input, {
    status: "success",
    submission: { status: "accepted", attempts_remaining: 2 },
    result: submitted.result,
  });
  const user = {
    id: "user-1",
    role: "user",
    content: [],
    action_facet_id: "word_document_authoring",
    action_facet_args: {
      document_name: "MSA.docx",
      document_snapshot: snapshot.token,
      heading_outline: wordDocumentOutlineText(snapshot),
      paragraphs_sent: "0",
    },
  } as unknown as Message;
  const plan = parseWordDocumentPlan(
    JSON.stringify((submitted.result as { plan: unknown }).plan),
  )!;
  return { snapshot, reads, submission, user, changed, plan };
}

const assistant = (content: ContentPart[]) =>
  ({
    id: "assistant-1",
    role: "assistant",
    previous_message_id: "user-1",
    content,
  }) as unknown as Message;

const changedGroups = (review: WordPlanReview) =>
  review.groups
    .filter((g) => g.status !== "unchanged")
    .map((g) => ({
      heading: g.heading?.text,
      rows: g.rows
        .filter((r) => r.family === "text")
        .map((r) => ({
          status: r.status,
          before: r.before,
          after: r.after?.text,
          unread: !!r.unread,
        })),
    }));

const liveReview = (
  plan: ReturnType<typeof parseWordDocumentPlan>,
  snapshot: WordAuthoringSnapshot,
) => buildWordPlanReview(normalizeWordDocumentPlan(plan!, snapshot), snapshot);

describe("a stored plan on a document too large for a complete read", () => {
  it("shows before and after per changed block, grouped by heading, as the live card does", async () => {
    const { snapshot, reads, submission, user, changed, plan } =
      await largeDocumentTurn();
    const answer = assistant([...reads, submission]);

    const proposal = wordHistoryProposal([user, answer], answer.content)!;
    expect(proposal.snapshot?.partial).toBeDefined();
    expect(proposal.documentName).toBe("MSA.docx");
    const history = buildWordPlanReview(proposal.plan, proposal.snapshot);
    const live = liveReview(plan, snapshot);

    expect(history.size).toBe("large");
    expect(history.title).toEqual(live.title);
    expect(history.riskUnknown).toBe(false);
    expect(history.risks).toEqual(live.risks);
    expect(changedGroups(history)).toEqual(changedGroups(live));
    expect(changedGroups(history)).toEqual(
      ["2.1 Section 2.1", "4.2 Section 4.2", "6.3 Section 6.3"].map(
        (heading, k) => ({
          heading,
          rows: [
            {
              status: "changed",
              before: changed[k].text,
              after: `Revised ${k}.`,
              unread: false,
            },
          ],
        }),
      ),
    );
  });

  it("groups a change whose block was never read under the outline's heading and says the original is missing", async () => {
    const { reads, submission, user, changed } = await largeDocumentTurn();
    const sectionReads = reads.filter(
      (part) =>
        part.content_type === "tool_use" &&
        !!part.input &&
        "section" in (part.input as object),
    );
    const answer = assistant([...sectionReads, submission]);

    const { plan, snapshot } = wordHistoryProposal(
      [user, answer],
      answer.content,
    )!;
    const groups = changedGroups(buildWordPlanReview(plan, snapshot));

    expect(groups.map((g) => g.heading)).toEqual([
      "2.1 Section 2.1",
      "4.2 Section 4.2",
      "6.3 Section 6.3",
    ]);
    expect(groups.map((g) => g.rows[0])).toEqual([
      {
        status: "changed",
        before: changed[0].text,
        after: "Revised 0.",
        unread: false,
      },
      {
        status: "changed",
        before: undefined,
        after: "Revised 1.",
        unread: true,
      },
      {
        status: "changed",
        before: undefined,
        after: "Revised 2.",
        unread: true,
      },
    ]);
  });
});
