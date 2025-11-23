/**
 * Utility functions for chat URL generation
 *
 * Centralizes the logic for determining correct URLs for chats,
 * ensuring assistant context is preserved when applicable.
 */

/**
 * Generates the correct URL path for a chat based on its context
 *
 * @param chatId - The ID of the chat
 * @param assistantId - Optional assistant ID if the chat is associated with an assistant
 * @returns The correct URL path
 *
 * @example
 * ```ts
 * // Regular chat
 * getChatUrl('chat-123', null) // => '/chat/chat-123'
 *
 * // Assistant chat
 * getChatUrl('chat-456', 'asst-789') // => '/a/asst-789/chat-456'
 * ```
 */
export function getChatUrl(
  chatId: string,
  assistantId?: string | null,
): string {
  if (assistantId) {
    return `/a/${assistantId}/${chatId}`;
  }
  return `/chat/${chatId}`;
}
