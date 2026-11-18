import { userTurnOf } from "@/lib/toolCallGist/spokenDictation";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UserTurn } from "@/lib/toolCallGist/spokenDictation";

/**
 * Which words of a sent message the user dictated, so a spoken approval card
 * can name a text by where it came from. Transcripts are noted as they land
 * in a composer and settled when its message is sent; a message is known by
 * its chat's compose session and its text, so the same words typed in
 * another chat are not dictated there. Kept for this page only: after a
 * reload a card names its texts as it does any long text.
 */

/** Transcripts that landed in a composer and were not sent yet, by compose session. */
const heard = new Map<string, string[]>();
/** The dictated words of each sent message, by compose session and text. */
const sent = new Map<string, UserTurn>();
/** Sent messages remembered; the oldest go first. */
const MAX_SENT = 200;

const keyOf = (sessionId: string, message: string) =>
  `${sessionId}\n${message.trim()}`;

export const noteDictatedTranscript = (
  sessionId: string,
  transcript: string,
): void => {
  if (transcript.trim().length === 0) return;
  heard.set(sessionId, [...(heard.get(sessionId) ?? []), transcript]);
};

/** The composer of `sessionId` sends `message`: what of it was dictated is kept. */
export const settleDictation = (sessionId: string, message: string): void => {
  const transcripts = heard.get(sessionId);
  heard.delete(sessionId);
  if (!transcripts) return;
  const turn = userTurnOf(message, transcripts);
  if (turn.passages.length === 0) return;
  const key = keyOf(sessionId, message);
  sent.delete(key);
  sent.set(key, turn);
  while (sent.size > MAX_SENT) {
    const oldest = sent.keys().next().value;
    if (oldest === undefined) break;
    sent.delete(oldest);
  }
};

/** What the user dictated of a message sent from a compose session, if anything. */
export const dictatedTurnFor = (
  sessionId: string,
  message: string,
): UserTurn | undefined => sent.get(keyOf(sessionId, message));

/**
 * The user's messages in a chat before `messageId`, the latest first, with
 * what of them was dictated; none when nothing was. `sessionId` is the
 * chat's compose session.
 */
export const userTurnsBefore = (
  sessionId: string,
  messages: Readonly<
    Record<string, { role?: string; content?: ContentPart[] } | undefined>
  >,
  order: readonly string[],
  messageId: string,
): UserTurn[] => {
  const end = order.indexOf(messageId);
  const before = end === -1 ? order : order.slice(0, end);
  const turns: UserTurn[] = [];
  for (const id of [...before].reverse()) {
    const message = messages[id];
    if (message?.role !== "user") continue;
    const text = extractTextFromContent(message.content).trim();
    // A typed message counts too: it may correct an earlier dictation.
    turns.push(
      dictatedTurnFor(sessionId, text) ?? { text, passages: [], whole: false },
    );
  }
  return turns.some((turn) => turn.passages.length > 0) ? turns : [];
};

/** For tests: forgets everything. */
export const forgetDictation = (): void => {
  heard.clear();
  sent.clear();
};
