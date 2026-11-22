import {
  WORD_PLAN_SECTIONS_TOOL,
  WORD_SUBMIT_PLAN_TOOL,
  WORD_WRITE_SECTION_TOOL,
} from "@erato/frontend/word-review";

import { storedWordToolPart } from "./historyReads";
import {
  noteWordCapturedIds,
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
  resetWordChangeJournalForTests,
  wordChangePosition,
} from "../../../word/utils/wordChangeJournal";
import { createWordDocumentPartExecutors } from "../../../word/utils/wordDocumentPartTools";
import { WordDocumentReadSession } from "../../../word/utils/wordDocumentReadTool";
import { createWordDocumentSubmissionExecutor } from "../../../word/utils/wordDocumentSubmission";

import type { WordDocumentBuild } from "../../../word/utils/buildWordDocumentArgs";
import type { WordReadCapture } from "../../../word/utils/wordReadFreshness";
import type {
  ClientToolCallContext,
  ClientToolExecutionResult,
  ContentPart,
} from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** A change in parts run through the pane's own executors, with every call stored as the chat
 * stores it: the message content a card reads back. */
export interface RecordedPartsTurn {
  session: WordDocumentReadSession;
  readToken: string;
  content: ContentPart[];
  /** The section plan's call id, which the parts card is keyed by. */
  sectionPlanCall: string;
  /** The last call's result. */
  last: ClientToolExecutionResult;
}

function stored(
  id: string,
  name: string,
  input: Record<string, unknown>,
  result: ClientToolExecutionResult,
): ContentPart {
  if (!result.ok)
    return {
      ...storedWordToolPart(name, id, input, {
        status: "error",
        error: result.error,
        validation_errors: result.validationErrors ?? [],
      }),
      status: "error",
    } as ContentPart;
  return storedWordToolPart(name, id, input, {
    status: "success",
    result: result.result,
    ...(name === WORD_SUBMIT_PLAN_TOOL
      ? { submission: { status: "accepted" } }
      : {}),
  });
}

/** Pages the whole capture through the session's reader; returns the complete read's token. */
export async function completeWordRead(
  session: WordDocumentReadSession,
  snapshot: WordAuthoringSnapshot,
  context: () => ClientToolCallContext,
): Promise<string> {
  let cursor: string | null = null;
  let readToken = "";
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
    readToken = result.readToken ?? readToken;
  } while (cursor);
  return readToken;
}

/** The change journal's view of `snapshot` as captured now, and a way to edit one of its blocks
 * in Word as the user would. */
export function wordCaptureJournal(snapshot: WordAuthoringSnapshot): {
  capture: WordReadCapture;
  edit: (ref: string) => void;
} {
  resetWordChangeJournalForTests();
  noteWordChangeEventsActive();
  const ordinalMap: WordDocumentBuild["ordinalMap"] = new Map();
  snapshot.blocks.forEach((block, k) => {
    ordinalMap.set(k + 1, { uniqueLocalId: `p${k + 1}`, text: block.text });
    block.paragraphOrdinal = k + 1;
  });
  noteWordCapturedIds([...ordinalMap.values()].map((p) => p.uniqueLocalId));
  const ordinalOf = new Map(snapshot.blocks.map((b, k) => [b.ref, k + 1]));
  return {
    capture: {
      changes: {
        position: wordChangePosition(),
        capturedAt: "2026-11-21T09:00:00.000Z",
      },
      ordinalMap,
    },
    edit: (ref) =>
      recordWordParagraphEvent({
        type: "ParagraphChanged",
        source: "Local",
        uniqueLocalIds: [`p${ordinalOf.get(ref)}`],
      }),
  };
}

export async function recordPartsTurn(
  snapshot: WordAuthoringSnapshot,
  {
    messageId = "message-A",
    plan,
    parts,
    finish = true,
    finishes = finish ? 1 : 0,
    capture,
    beforeFinish,
  }: {
    messageId?: string;
    plan: Record<string, unknown>;
    parts: { row: number; ops: unknown; allow?: string[] }[];
    finish?: boolean;
    /** A second finish at the same revision leaves rows without a part as they are. */
    finishes?: number;
    capture?: WordReadCapture;
    beforeFinish?: () => void;
  },
): Promise<RecordedPartsTurn> {
  let calls = 0;
  const context = () => ({
    chatId: "chat-A",
    messageId,
    toolCallId: `call-${messageId}-${++calls}`,
  });
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context(), undefined, capture && { capture });
  const readToken = await completeWordRead(session, snapshot, context);
  const executors = createWordDocumentPartExecutors(session);
  const submit = createWordDocumentSubmissionExecutor(session);
  const content: ContentPart[] = [];
  const ids: string[] = [];
  const run = async (
    name: string,
    input: Record<string, unknown>,
    execute: (
      input: Record<string, unknown>,
      call: ReturnType<typeof context>,
    ) => Promise<ClientToolExecutionResult>,
  ) => {
    const call = context();
    ids.push(call.toolCallId);
    const result = await execute(input, call);
    content.push(stored(call.toolCallId, name, input, result));
    return result;
  };
  let last = await run(
    WORD_PLAN_SECTIONS_TOOL,
    { snapshot: snapshot.token, readToken, ...plan },
    executors.plan,
  );
  if (!last.ok) throw new Error(JSON.stringify(last.validationErrors));
  let { draft_id, revision } = last.result as {
    draft_id: string;
    revision: number;
  };
  for (const part of parts) {
    last = await run(
      WORD_WRITE_SECTION_TOOL,
      {
        snapshot: snapshot.token,
        draft_id,
        row: part.row,
        ops: part.ops,
        ...(part.allow ? { allow: part.allow } : {}),
      },
      executors.write,
    );
    if (last.ok) ({ revision } = last.result as { revision: number });
  }
  if (finishes) beforeFinish?.();
  for (let k = 0; k < finishes; k++)
    last = await run(
      WORD_SUBMIT_PLAN_TOOL,
      { snapshot: snapshot.token, readToken, draft_id, revision, finish: true },
      submit,
    );
  return { session, readToken, content, sectionPlanCall: ids[0], last };
}
