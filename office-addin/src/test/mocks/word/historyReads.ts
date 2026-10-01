import { WORD_READ_TOOL } from "@erato/frontend/word-review";

import { WordDocumentReadSession } from "../../../word/utils/wordDocumentReadTool";

import type { ContentPart } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** Pages a capture through the real reader and stores each page as chat history does. */
export async function storedWordReads(
  snapshot: WordAuthoringSnapshot,
  messageId = "message-A",
): Promise<ContentPart[]> {
  const context = { toolCallId: "read", messageId, chatId: "chat-A" };
  const session = new WordDocumentReadSession();
  session.activate(snapshot, context);
  const parts: ContentPart[] = [];
  let cursor: string | null = null;
  do {
    const input = { snapshot: snapshot.token, cursor };
    const page = await session.execute(input, {
      ...context,
      toolCallId: `read-${parts.length + 1}`,
    });
    if (!page.ok) throw new Error(page.error);
    parts.push(
      JSON.parse(
        JSON.stringify({
          content_type: "tool_use",
          tool_name: WORD_READ_TOOL,
          tool_call_id: `read-${parts.length + 1}`,
          status: "success",
          input,
          output: { status: "success", result: page.result },
        }),
      ) as ContentPart,
    );
    cursor = (page.result as { nextCursor: string | null }).nextCursor;
  } while (cursor);
  return parts;
}
