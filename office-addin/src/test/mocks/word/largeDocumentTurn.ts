import {
  parseWordDocumentPlan,
  WORD_READ_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
} from "@erato/frontend/word-review";
import { expect } from "vitest";

import { storedWordToolPart as stored } from "./historyReads";
import {
  body,
  chapter,
  readContext,
  sectionPackageXml,
} from "./sectionFixtures";
import { wordDocumentOutlineText } from "../../../word/utils/wordDocumentOutline";
import { WordDocumentReadSession } from "../../../word/utils/wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../../../word/utils/wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../../../word/utils/wordDocumentXml";

import type { SectionBlock } from "./sectionFixtures";
import type { ContentPart, Message } from "@erato/frontend/library";

const agreement: SectionBlock[] = [
  body("Master Services Agreement"),
  ...[47, 40, 30, 30, 30, 30].flatMap((kib, k) => chapter(k + 1, kib)),
];

export interface LargeDocumentTurn {
  blocks?: SectionBlock[];
  numberedHeadings?: boolean;
  /** The headings whose sections Erato reads first. */
  sections?: string[];
  /** The paragraphs Erato replaces, each named by the heading it follows. */
  replaced?: string[];
  deleted?: string[];
}

/** A turn on a document too large for a complete read, stored as chat history stores it. */
export async function largeDocumentTurn({
  blocks = agreement,
  numberedHeadings = false,
  sections = ["2.1 Section 2.1"],
  replaced = ["2.1 Section 2.1", "4.2 Section 4.2", "6.3 Section 6.3"],
  deleted = [],
}: LargeDocumentTurn = {}) {
  const snapshot = captureWordAuthoringSnapshot(
    sectionPackageXml(blocks, { numberedHeadings }),
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
  const at = (title: string) =>
    snapshot.blocks.findIndex((b) => b.text === title);
  const after = (title: string) => snapshot.blocks[at(title) + 1];
  for (const title of sections) {
    let cursor: unknown = null;
    do
      cursor = (
        await read({
          section: {
            ref: snapshot.blocks[at(title)].ref,
            ...(cursor ? { cursor } : {}),
          },
        })
      ).nextCursor;
    while (cursor);
  }
  const changed = replaced.map(after);
  const removed = deleted.map(after);
  const { readToken } = await read({
    target: { refs: [...changed, ...removed].map((b) => b.ref) },
  });
  const input = {
    snapshot: snapshot.token,
    readToken,
    scoped_edit: {
      body: [
        ...changed.map((b, k) => ({
          operation: "replace",
          source: [b.ref],
          blocks: [{ id: `n${k}`, type: "paragraph", text: `Revised ${k}.` }],
        })),
        ...removed.map((b) => ({
          operation: "delete",
          source: [b.ref],
          reason: "Duplicate clause.",
        })),
      ],
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
