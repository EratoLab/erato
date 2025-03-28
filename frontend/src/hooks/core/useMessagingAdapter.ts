/**
 * Adapter hook to ease migration from useMessageStream to useMessagingContext
 */
import { useEffect } from "react";

import { useMessageStream } from "@/components/containers/MessageStreamProvider";

import type { SendMessageOptions } from "@/components/containers/MessagingProvider";
import type { Message } from "@/state/types/message.types";
import type { StreamingStatus } from "@/state/types/streaming.types";

export interface LegacyMessagingResult {
  // Legacy interface
  currentStreamingMessage: {
    content: string;
    isComplete: boolean;
    error?: Error;
  } | null;
  streamMessage: (
    chatId: string,
    userMessageContent: string,
    lastMessageId?: string,
    fileIds?: string[],
  ) => Promise<void>;
  cancelStreaming: () => void;
  resetStreaming: () => void;
}

export interface ModernMessagingResult {
  // New interface
  messages: Record<string, Message>;
  messageOrder: string[];
  sendMessage: (
    content: string,
    options?: SendMessageOptions,
  ) => Promise<
    | {
        userMessageId: string;
        assistantMessageId: string;
      }
    | undefined
  >;
  cancelMessage: () => void;
  isStreaming: boolean;
  streamingStatus: StreamingStatus;
  currentStreamingMessageId: string | null;
}

/**
 * Hook that provides the legacy messaging interface
 * but logs deprecation warnings
 *
 * @returns The legacy interface
 */
export function useMessagingAdapter(): LegacyMessagingResult {
  // Use the legacy interface
  const legacyInterface = useMessageStream();

  // Add deprecation warning
  useEffect(() => {
    console.warn(
      "useMessageStream is deprecated - please migrate to useMessagingContext from MessagingProvider",
    );
  }, []);

  return legacyInterface;
}
