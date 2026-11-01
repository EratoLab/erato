import type { ContentPartTaskResult } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

type FoldableMessage = Pick<
  Message,
  "id" | "role" | "content" | "previous_message_id"
>;

/** The delivered task result a user-role row carries, if it is one. */
export const taskResultOf = (
  message: Pick<Message, "role" | "content">,
): ContentPartTaskResult | undefined => {
  if (message.role !== "user") return undefined;
  const part = message.content.find(
    (candidate) => candidate.content_type === "task_result",
  );
  return part?.content_type === "task_result" ? part : undefined;
};

/**
 * Whether the conversation holds a later delivery for the same task: each
 * delivery of a run bumps `sequence`, so a higher one reported after it.
 */
export function hasLaterTaskResult(
  messages: Readonly<
    Record<string, Pick<Message, "role" | "content"> | undefined>
  >,
  childChatId: string,
  sequence: number,
): boolean {
  return Object.values(messages).some((message) => {
    const part = message ? taskResultOf(message) : undefined;
    return part?.child_chat_id === childChatId && part.sequence > sequence;
  });
}

interface TaskResultFold {
  rowId: string;
  part: ContentPartTaskResult;
}

export interface TaskResultFolds {
  /** Result rows drawn inside their reply instead of on their own. */
  foldedRowIds: ReadonlySet<string>;
  /** Per reply id, the result it answers and the row that carried it. */
  byReplyId: Readonly<Partial<Record<string, TaskResultFold>>>;
}

export const NO_TASK_RESULT_FOLDS: TaskResultFolds = {
  foldedRowIds: new Set(),
  byReplyId: {},
};

/**
 * Pairs each delivered task result with the assistant reply directly below it.
 * Order decides, not `previous_message_id`: a reply that is still streaming
 * does not carry one yet.
 */
export function getTaskResultFolds(
  messages: Readonly<Record<string, FoldableMessage | undefined>>,
  messageOrder: readonly string[],
): TaskResultFolds {
  const foldedRowIds = new Set<string>();
  const byReplyId: Record<string, TaskResultFold> = {};

  for (let index = 0; index < messageOrder.length - 1; index++) {
    const row = messages[messageOrder[index]];
    const part = row && taskResultOf(row);
    const reply = messages[messageOrder[index + 1]];
    if (
      !row ||
      !part ||
      reply?.role !== "assistant" ||
      (reply.previous_message_id !== undefined &&
        reply.previous_message_id !== row.id)
    ) {
      continue;
    }
    foldedRowIds.add(row.id);
    byReplyId[reply.id] = { rowId: row.id, part };
  }

  return foldedRowIds.size === 0
    ? NO_TASK_RESULT_FOLDS
    : { foldedRowIds, byReplyId };
}
