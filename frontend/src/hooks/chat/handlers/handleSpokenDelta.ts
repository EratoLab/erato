import { applyTextLikeDelta } from "./handleTextDelta";

import type { MessageSubmitStreamingResponseMessageTextDelta } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles the text of a reply's spoken part: what the voice says, kept apart
 * from the written answer that streams as `text_delta`.
 */
export const handleSpokenDelta = (
  responseData: MessageSubmitStreamingResponseMessageTextDelta & {
    message_type: "spoken_delta";
  },
  streamKey?: string,
): void =>
  applyTextLikeDelta(
    "spoken",
    responseData.content_index,
    responseData.new_text,
    streamKey,
    "messaging/handleSpokenDelta",
  );
