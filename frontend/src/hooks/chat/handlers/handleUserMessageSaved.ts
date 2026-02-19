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
 * 4. The server-confirmed message (with its real ID and details) is then added to the store.
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

      // Find the temporary message by content comparison (extract text from ContentPart[])
      const tempMessage = Object.values(newUserMessages).find(
        (msg) =>
          msg.role === "user" &&
          extractTextFromContent(msg.content) ===
            serverConfirmedMessageContent &&
          msg.status === "sending",
      );

      if (tempMessage?.id) {
        const tempMessageKeyToDelete = tempMessage.id; // This key is the temp-user-id
        delete newUserMessages[tempMessageKeyToDelete]; // Remove message with temp ID

        // Construct the final message object using server data
        const finalUserMessage = {
          id: serverConfirmedMessage.id,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          content: serverConfirmedMessage.content ?? [],
          role: serverConfirmedMessage.role as "user", // Role from server, cast as "user"
          createdAt: serverConfirmedMessage.created_at,
          status: "complete" as const, // Message is saved, so status is complete
          input_files_ids: serverConfirmedMessage.input_files_ids,
        };

        newUserMessages[finalUserMessage.id] = finalUserMessage; // Add message with real ID

        if (process.env.NODE_ENV === "development") {
          logger.log(
            `User message ID updated: from ${tempMessageKeyToDelete} to ${finalUserMessage.id}. Content: "${extractTextFromContent(finalUserMessage.content).substring(0, 50)}..."`,
          );
        }

        const assistantTimestamp = new Date(
          new Date(serverConfirmedMessage.created_at).getTime() + 1,
        ).toISOString();
        const activeResolvedStreamKey = resolveStreamKeyFromState(
          prevState.activeStreamKey,
          prevState.streamKeyAliases,
        );
        const nextUserMessagesByKey = {
          ...prevState.userMessagesByKey,
          [resolvedStreamKey]: newUserMessages,
        };

        const currentMessageId = currentStreaming.currentMessageId;
        const pointsToUserMessage =
          (typeof currentMessageId === "string" &&
            (currentMessageId === tempMessageKeyToDelete ||
              currentMessageId === finalUserMessage.id ||
              currentMessageId.startsWith("temp-user-"))) ||
          (typeof currentMessageId === "string" &&
            newUserMessages[currentMessageId].role === "user");

        // ERMAIN-88 FIX: Only create optimistic assistant if one doesn't already exist
        // The optimistic assistant is now created immediately in sendMessage()
        const hasOptimisticAssistant =
          currentMessageId?.startsWith("temp-assistant-") &&
          !pointsToUserMessage;

        if (hasOptimisticAssistant) {
          if (process.env.NODE_ENV === "development") {
            logger.log(
              `[OPTIMISTIC] Updating optimistic assistant placeholder timestamp: ${currentStreaming.createdAt} → ${assistantTimestamp} (after user message: ${serverConfirmedMessage.created_at})`,
            );
          }
          const nextStreaming = {
            ...currentStreaming,
            createdAt: assistantTimestamp,
          };

          return {
            ...prevState,
            userMessagesByKey: nextUserMessagesByKey,
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
        }

        // If we already have an assistant anchor (real assistant ID), keep it
        // and only force ordering behind the confirmed user message.
        const hasExistingAssistantAnchor =
          !!currentMessageId && !pointsToUserMessage;

        if (hasExistingAssistantAnchor) {
          if (process.env.NODE_ENV === "development") {
            logger.log(
              `[OPTIMISTIC] Preserving existing assistant stream anchor (${currentMessageId}) and adjusting timestamp to ${assistantTimestamp}.`,
            );
          }

          const nextStreaming = {
            ...currentStreaming,
            createdAt: assistantTimestamp,
          };

          return {
            ...prevState,
            userMessagesByKey: nextUserMessagesByKey,
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
        }

        // Fallback: Create/repair optimistic assistant placeholder if stream anchor
        // points to a user message or is missing.
        const optimisticAssistantId = `temp-assistant-${Date.now()}`;

        if (process.env.NODE_ENV === "development") {
          logger.log(
            `[OPTIMISTIC] Creating/repairing optimistic assistant placeholder with ID: ${optimisticAssistantId}. Previous anchor: ${String(currentMessageId)}`,
          );
        }

        const nextStreaming = {
          ...currentStreaming,
          currentMessageId: optimisticAssistantId,
          content: [],
          createdAt: assistantTimestamp, // Ensure assistant renders after confirmed user
          isStreaming: false, // Not streaming yet, just a placeholder
          isFinalizing: false,
          toolCalls: {},
        };
        return {
          ...prevState,
          userMessagesByKey: nextUserMessagesByKey,
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
      } else {
        // If no matching temp message found, log a warning.
        // This could happen if the message was cleared or if there's a mismatch.
        logger.warn(
          `No temporary user message found to update for content: "${serverConfirmedMessageContent.substring(0, 100)}...". This might happen if the message was cleared or if there is a data mismatch.`,
          {
            serverConfirmedMessage,
            previousUserMessages: currentUserMessagesForKey, // Log the state before attempting update
          },
        );
      }
      // If no temp message was found to replace, return the previous state unchanged
      logger.log(
        "No matching temporary message found, returning previous state.",
        {
          serverContent: serverConfirmedMessageContent,
          currentMessages: currentUserMessagesForKey,
        },
      );
      return prevState;
    },
    false,
    "messaging/handleUserMessageSaved",
  );
}
