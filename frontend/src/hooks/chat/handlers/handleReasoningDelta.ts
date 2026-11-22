import { applyTextLikeDelta } from "./handleTextDelta";

import type { MessageSubmitStreamingResponseMessageReasoningDelta } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Handles reasoning delta events from the streaming API response.
 */
export const handleReasoningDelta = (
  responseData: MessageSubmitStreamingResponseMessageReasoningDelta & {
    message_type: "reasoning_delta";
  },
  streamKey?: string,
): void =>
  applyTextLikeDelta(
    "reasoning",
    responseData.content_index,
    responseData.new_text,
    streamKey,
    "messaging/handleReasoningDelta",
  );
