import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";
import { createLogger } from "@/utils/debugLogger";

import { useMessagingStore } from "../store/messagingStore";

import type { MessageSubmitStreamingResponseUserMessageSaved } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const logger = createLogger("EVENT", "handleUserMessageSaved");

/**
 * Handles the 'user_message_saved' event from the streaming API response.
 *
 * This function is responsible for updating the local message store when the backend
 * confirms that a user's message has been successfully saved. It plays a crucial
 * role in replacing optimistically added user messages (which have temporary IDs)
 * with their server-confirmed counterparts, including their permanent IDs.
 *
 * The process involves:
 * 1. Receiving the event data containing the saved message details from the server.
 * 2. Finding the corresponding temporary message in the Zustand store, typically by
 *    matching content and its 'sending' status.
 * 3. If a match is found, the temporary message is removed from the store.
 * 4. The server-confirmed message (with its real ID and details) is added to the
 *    store, whether or not a temporary message was found.
 * This ensures the UI reflects the authoritative state from the backend.
 *
 * @param responseData - The data from the 'user_message_saved' SSE event.
 *                       Contains `message`, which is a `MessageSubmitMessageResponseSchema`
 *                       object with the details of the saved user message.
 * @returns void
 */
export function handleUserMessageSaved(
  responseData: MessageSubmitStreamingResponseUserMessageSaved & {
    message_type: "user_message_saved";
  },
  streamKey?: string,
): void {
  const serverConfirmedMessage = responseData.message;
  const serverConfirmedMessageContent = extractTextFromContent(
    serverConfirmedMessage.content,
  );

  // Validation: serverConfirmedMessage should have expected structure
  if (
    !serverConfirmedMessage.id ||
    typeof serverConfirmedMessageContent !== "string"
  ) {
    logger.error("Invalid server-confirmed message structure:", responseData);
    return;
  }

  logger.log(
    `Server confirmed user message. Message ID: ${serverConfirmedMessage.id}, Content: "${serverConfirmedMessageContent.substring(0, 50)}..."`,
  );

  useMessagingStore.setState(
    (prevState) => {
      const resolveStreamKeyFromState = (
        streamKeyToResolve: string,
        aliases: Record<string, string>,
      ): string => {
        let resolvedKey = streamKeyToResolve;
        const visited = new Set<string>();
        while (aliases[resolvedKey] && !visited.has(resolvedKey)) {
          visited.add(resolvedKey);
          resolvedKey = aliases[resolvedKey];
        }
        return resolvedKey;
      };

      const inputStreamKey = streamKey ?? prevState.activeStreamKey;
      const resolvedStreamKey = resolveStreamKeyFromState(
        inputStreamKey,
        prevState.streamKeyAliases,
      );
      const currentStreaming =
        prevState.streamingByKey[resolvedStreamKey] ?? prevState.streaming;
      const currentUserMessagesForKey =
        prevState.userMessagesByKey[resolvedStreamKey] ?? {};
      const newUserMessages = { ...currentUserMessagesForKey };
      const activeResolvedStreamKey = resolveStreamKeyFromState(
        prevState.activeStreamKey,
        prevState.streamKeyAliases,
      );

      const finalUserMessage = {
        id: serverConfirmedMessage.id,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        content: serverConfirmedMessage.content ?? [],
        role: serverConfirmedMessage.role as "user", // Role from server, cast as "user"
        createdAt: serverConfirmedMessage.created_at,
        status: "complete" as const, // Message is saved, so status is complete
        input_files_ids: serverConfirmedMessage.input_files_ids,
      };

      // Find the temporary message by content comparison (extract text from ContentPart[])
      const tempMessage = Object.values(newUserMessages).find(
        (msg) =>
          msg.role === "user" &&
          extractTextFromContent(msg.content) ===
            serverConfirmedMessageContent &&
          msg.status === "sending",
      );

      if (tempMessage?.id) {
        delete newUserMessages[tempMessage.id]; // Remove message with temp ID
      } else {
        // `resumestream` replays this event after the optimistic message is
        // gone. The server id keeps a repeated delivery idempotent, and
        // mergeDisplayMessages gives the API copy precedence over it.
        logger.log(
          `No temporary user message to reconcile; inserting server message ${serverConfirmedMessage.id} directly.`,
          {
            serverContent: serverConfirmedMessageContent,
            currentMessages: currentUserMessagesForKey,
          },
        );
      }

      newUserMessages[finalUserMessage.id] = finalUserMessage; // Add message with real ID

      if (process.env.NODE_ENV === "development") {
        logger.log(
          `User message stored under ${finalUserMessage.id} (was ${tempMessage?.id ?? "absent"}). Content: "${extractTextFromContent(finalUserMessage.content).substring(0, 50)}..."`,
        );
      }

      // Ordering is by createdAt, and user messages carry the server's clock
      // while an unanchored assistant falls back to the browser's. Pin the
      // assistant just behind the confirmed user message so skew between the
      // two cannot float the answer above its question.
      const assistantTimestamp = new Date(
        new Date(serverConfirmedMessage.created_at).getTime() + 1,
      ).toISOString();

      const currentMessageId = currentStreaming.currentMessageId;
      const currentAnchoredMessage =
        typeof currentMessageId === "string"
          ? newUserMessages[currentMessageId]
          : undefined;
      const pointsToUserMessage =
        (typeof currentMessageId === "string" &&
          (currentMessageId === tempMessage?.id ||
            currentMessageId === finalUserMessage.id ||
            currentMessageId.startsWith("temp-user-"))) ||
        currentAnchoredMessage?.role === "user";
      const hasAssistantAnchor = !!currentMessageId && !pointsToUserMessage;

      // Without an assistant anchor, create/repair an optimistic placeholder;
      // assistant_message_started later swaps in the real id and keeps this
      // timestamp.
      const nextStreaming = hasAssistantAnchor
        ? { ...currentStreaming, createdAt: assistantTimestamp }
        : {
            ...currentStreaming,
            currentMessageId: `temp-assistant-${Date.now()}`,
            content: [],
            createdAt: assistantTimestamp,
            isStreaming: false, // Not streaming yet, just a placeholder
            isFinalizing: false,
          };

      if (process.env.NODE_ENV === "development") {
        logger.log(
          `[OPTIMISTIC] Assistant anchor ${currentMessageId ?? "none"} → ${nextStreaming.currentMessageId ?? "none"} at ${assistantTimestamp}.`,
        );
      }

      return {
        ...prevState,
        userMessagesByKey: {
          ...prevState.userMessagesByKey,
          [resolvedStreamKey]: newUserMessages,
        },
        userMessages:
          activeResolvedStreamKey === resolvedStreamKey
            ? newUserMessages
            : prevState.userMessages,
        streamingByKey: {
          ...prevState.streamingByKey,
          [resolvedStreamKey]: nextStreaming,
        },
        streaming:
          activeResolvedStreamKey === resolvedStreamKey
            ? nextStreaming
            : prevState.streaming,
      };
    },
    false,
    "messaging/handleUserMessageSaved",
  );
}
