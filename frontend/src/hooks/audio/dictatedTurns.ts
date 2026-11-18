import { dictatedPassages } from "@/lib/toolCallGist/spokenDictation";
import { extractTextFromContent } from "@/utils/adapters/contentPartAdapter";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { DictatedTurn } from "@/lib/toolCallGist/spokenDictation";

/**
 * Which words of a sent message the user dictated, so a spoken approval card
 * can name a text by where it came from. Transcripts are noted as they land
 * in a composer and settled when its message is sent; a message is known by
 * its text. Kept for this page only: after a reload a card names its texts
 * as it does any long text.
 */

/** Transcripts that landed in a composer and were not sent yet, by compose session. */
const heard = new Map<string, string[]>();
/** The dictated runs of each sent message, by its text. */
const sent = new Map<string, DictatedTurn>();
/** Sent messages remembered; the oldest go first. */
const MAX_SENT = 200;

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
  const text = message.trim();
  const passages = dictatedPassages(text, transcripts);
  if (passages.length === 0) return;
  sent.delete(text);
  sent.set(text, { passages });
  while (sent.size > MAX_SENT) {
    const oldest = sent.keys().next().value;
    if (oldest === undefined) break;
    sent.delete(oldest);
  }
};

/** What the user dictated of a message, if anything. */
export const dictatedTurnOf = (message: string): DictatedTurn | undefined =>
  sent.get(message.trim());

/**
 * What the user dictated in the turns of a chat before `messageId`, the
 * latest first.
 */
export const dictatedTurnsBefore = (
  messages: Readonly<
    Record<string, { role?: string; content?: ContentPart[] } | undefined>
  >,
  order: readonly string[],
  messageId: string,
): DictatedTurn[] => {
  const end = order.indexOf(messageId);
  const before = end === -1 ? order : order.slice(0, end);
  const turns: DictatedTurn[] = [];
  for (const id of [...before].reverse()) {
    const message = messages[id];
    if (message?.role !== "user") continue;
    const turn = dictatedTurnOf(extractTextFromContent(message.content));
    if (turn) turns.push(turn);
  }
  return turns;
};

/** For tests: forgets everything. */
export const forgetDictation = (): void => {
  heard.clear();
  sent.clear();
};
