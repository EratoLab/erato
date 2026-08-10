import type { ParsedTeamsChat } from "./parsedTeamsChat";

/**
 * Name filter over already-loaded chats. Deliberately local: finding a person
 * must feel instant and must not spend a request against the per-chat ceiling.
 * Content search is a different operation with a different result type.
 */
export function filterTeamsChats(
  chats: ParsedTeamsChat[],
  query: string,
): ParsedTeamsChat[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return chats;
  return chats.filter((chat) => {
    // Every token must appear somewhere, so "max gois" and "gois max" both
    // find "Maximilian Goisser" without needing the words in order.
    const haystack = [chat.title, ...chat.participants].join(" ").toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
