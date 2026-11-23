import { loadApprovalNotice } from "./approvalSpeech";
import { deploymentConfirmationPhrases } from "./confirmationPhrases";
import { sayAsideLine, stopAsideLine, waitTurnNow } from "./waitLines";

import type { LoadedNotice, SpeakableCard } from "./approvalSpeech";

/**
 * The voice's word that an approval said by voice was taken ("All right,
 * I'm running it now."), said while the approval goes out, never that the
 * action is done. The voice speaks only while an approval waits, so the
 * sentence is loaded when the user first talks to a card that can be
 * decided by voice, and said from what was loaded once the approval is
 * sent. It plays as a wait line: the answer and the next card wait for it,
 * and it counts toward the turn's lines.
 */

/** Later than this after the approval went out, it is not said at all. */
export const ACKNOWLEDGEMENT_LATE_MS = 1500;

let held: { key: string; notice: LoadedNotice } | null = null;
let attempt: { cancelled: boolean; notice: LoadedNotice } | null = null;

const fold = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/** Whether `text` holds any language's confirmation phrase, word for word. */
export const holdsConfirmationPhrase = (text: string): boolean => {
  const words = fold(text);
  return Object.values(deploymentConfirmationPhrases()).some((phrase) => {
    const parts = fold(phrase ?? "");
    return (
      parts.length > 0 &&
      words.some((_, at) =>
        parts.every((part, offset) => words[at + offset] === part),
      )
    );
  });
};

/**
 * Loads the sentence for `card` while it waits, once per card: only a card
 * that can be approved by voice gets it. A sentence that would say a
 * confirmation phrase (a deployment's wording) is never loaded.
 */
export function prepareApprovalAcknowledgement(card: SpeakableCard) {
  if (!card.decision?.approves) return;
  if (held?.key === card.key && held.notice.state !== "failed") return;
  dropApprovalAcknowledgement();
  const notice = loadApprovalNotice(
    card.messageId,
    { kind: "approved" },
    card.language ?? "en",
  );
  if (!notice) return;
  if (holdsConfirmationPhrase(notice.text)) {
    notice.close();
    return;
  }
  held = { key: card.key, notice };
}

/** Forgets the loaded sentence: the card was refused, changed or left. */
export function dropApprovalAcknowledgement() {
  held?.notice.close();
  held = null;
}

/**
 * Says the sentence for the card under `key`, whose approval was just sent,
 * once the server took it (`accepted`) and the audio is there, both within
 * `ACKNOWLEDGEMENT_LATE_MS` of the sending. It is said in the turn the
 * approval began, and only while that turn is still waited for; a sentence
 * that comes later, failed, or would start after the answer's voice has
 * begun is not said. Resolves once it is said or left out.
 */
export async function sayApprovalAcknowledgement(
  key: string,
  accepted: Promise<boolean>,
): Promise<void> {
  const taken = held?.key === key ? held : null;
  held = null;
  if (!taken) return;
  const of = waitTurnNow();
  const current = { cancelled: false, notice: taken.notice };
  attempt = current;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const goesAhead = await Promise.race([
    Promise.all([taken.notice.settled, accepted]).then(([, ok]) => ok),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), ACKNOWLEDGEMENT_LATE_MS);
    }),
  ]);
  clearTimeout(timer);
  if (attempt === current) attempt = null;
  if (!goesAhead || current.cancelled || taken.notice.state !== "done") {
    taken.notice.close();
    return;
  }
  sayAsideLine(taken.notice.chunks, of);
}

/**
 * The approval did not go through: the sentence is not said, or stops now,
 * so the failure is heard next and nothing sounds as if it ran.
 */
export function cancelApprovalAcknowledgement() {
  if (attempt) {
    attempt.cancelled = true;
    attempt.notice.close();
  }
  attempt = null;
  stopAsideLine();
}
