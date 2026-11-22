import { readFileSync } from "node:fs";

import { expect } from "vitest";

import { wordDocumentFileToOoxml } from "../../../word/utils/wordDocumentPackage";
import { createWordDocumentPartExecutors } from "../../../word/utils/wordDocumentPartTools";
import { WordDocumentReadSession } from "../../../word/utils/wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../../../word/utils/wordDocumentSubmission";
import { captureWordAuthoringSnapshot } from "../../../word/utils/wordDocumentXml";

import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
} from "@erato/frontend/library";

export const WORD_PARTS_FIXTURES = `${process.cwd()}/src/test/fixtures/word-parts`;
const CONTRACT = new Uint8Array(
  readFileSync(`${WORD_PARTS_FIXTURES}/framework-contract.docx`),
);

let calls = 0;
export const partsContext = (): ClientToolCallContext => ({
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: `call-${++calls}`,
});

/** The framework contract captured and read completely, with the part tools of its request. */
export async function openWordParts({ request }: { request?: string } = {}) {
  const snapshot = captureWordAuthoringSnapshot(
    wordDocumentFileToOoxml(CONTRACT),
    "Rahmenvertrag.docx",
    "Off",
    true,
  );
  const session = new WordDocumentReadSession();
  session.activate(snapshot, partsContext(), undefined, { request });
  let cursor: string | null = null;
  let readToken: string | undefined;
  do {
    const page = await session.execute(
      { snapshot: snapshot.token, cursor },
      partsContext(),
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
      parts.plan({ ...base, readToken, ...input }, partsContext()),
    write: (
      draft: string,
      row: number,
      ops: unknown,
      call = partsContext(),
      allow?: string[],
    ) =>
      parts.write(
        { ...base, draft_id: draft, row, ops, ...(allow ? { allow } : {}) },
        call,
      ),
    finish: (draft: string, revision: number, call = partsContext()) =>
      submit(
        { ...base, readToken, draft_id: draft, revision, finish: true },
        call,
      ),
    submit: (input: Record<string, unknown>) =>
      submit({ ...base, readToken, ...input }, partsContext()),
  };
}

export type WordPartsReceipt = {
  draft_id: string;
  revision: number;
  rows: { row: number; title: string; status: string; allowed?: string[] }[];
  rows_left: number[];
  allowed?: string[];
  fix_requests?: {
    title: string;
    issues: { code: string; message: string }[];
  }[];
};

export const partsReceipt = (result: ClientToolExecutionResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.validationErrors));
  return result.result as WordPartsReceipt;
};

export const partsRejection = (result: ClientToolExecutionResult) => {
  expect(result.ok).toBe(false);
  return result.ok ? undefined : result;
};
