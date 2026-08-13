/**
 * Chat messages have a null `webUrl` (Graph populates it for channel messages
 * only), so the permalink is constructed. Percent-encoding is load-bearing:
 * chat ids contain `:` and `@` (`19:…@thread.v2`).
 */

const TEAMS_MESSAGE_DEEP_LINK_ROOT = "https://teams.microsoft.com/l/message";
const TEAMS_CHAT_CONTEXT_QUERY =
  "?context=%7B%22contextType%22%3A%22chat%22%7D";

export function buildTeamsMessageDeepLink(
  chatId: string,
  messageId: string,
): string {
  const chat = encodeURIComponent(chatId);
  const message = encodeURIComponent(messageId);
  return `${TEAMS_MESSAGE_DEEP_LINK_ROOT}/${chat}/${message}${TEAMS_CHAT_CONTEXT_QUERY}`;
}
