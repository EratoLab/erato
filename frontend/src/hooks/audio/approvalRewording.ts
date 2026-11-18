import { useContext } from "react";

import { fetchRewordApproval } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { rewordingRequest } from "@/lib/toolCallGist/spokenCardRewording";
import { useOptionalAudioConversationalFeature } from "@/providers/FeatureConfigProvider";
import { ProfileContext } from "@/providers/ProfileProvider";

import type { SpokenOptions, SpokenPiece } from "@/lib/toolCallGist/spokenCard";
import type { RewordedPiece } from "@/lib/toolCallGist/spokenCardRewording";

/**
 * The natural reading of a waiting card, asked for as soon as the card
 * waits, while the model's own words still play, so it rarely delays the
 * card. The backend answers every piece with a checked wording or its
 * precise text; anything that goes wrong here leaves the card precise.
 */

/** Beyond the backend's own limit, which answers precisely in time. */
const CLIENT_TIMEOUT_MS = 12_000;
/**
 * How long a card that is due to be said waits for its natural wording; a
 * wording that comes later is not used, and the card is said precisely.
 */
export const NATURAL_WAIT_AT_START_MS = 600;

const asked = new Map<string, Promise<RewordedPiece[] | undefined>>();

/** The card under `key` as composed: another composition is another request. */
const askedKey = (key: string, pieces: readonly SpokenPiece[]): string =>
  `${key}\n${JSON.stringify(pieces.map((piece) => [piece.id, piece.text]))}`;

/** Whether a user hears approval cards in the natural style. */
export function useNaturalApprovalSpeech(): boolean {
  const audio = useOptionalAudioConversationalFeature();
  const own =
    useContext(ProfileContext)?.profile?.preference_approval_speech_style;
  if (!audio) return false;
  const style =
    audio.approvalSpeechUserChoice && own ? own : audio.approvalSpeechStyle;
  return style === "natural";
}

/**
 * The backend's answer for the card under `key` as `pieces` compose it:
 * asked for once per composition. The caller puts it on the pieces it says
 * with `withRewording`, so the answer can never change which pieces are
 * said. `undefined` when the backend is off, slow or fails.
 */
export function naturalWordings(
  key: string,
  messageId: string,
  pieces: SpokenPiece[],
  options: Pick<SpokenOptions, "language" | "now" | "timeZone">,
): Promise<RewordedPiece[] | undefined> {
  const id = askedKey(key, pieces);
  const known = asked.get(id);
  if (known) return known;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);
  const request = rewordingRequest(pieces, options);
  const answer = fetchRewordApproval(
    {
      pathParams: { messageId },
      body: { language: request.language, pieces: request.pieces },
    },
    abort.signal,
  )
    .then((reworded) => reworded.pieces)
    .catch(() => undefined)
    .finally(() => clearTimeout(timer));
  asked.set(id, answer);
  return answer;
}

/** Forgets the answers for cards that no longer wait. */
export function forgetNaturalApprovals(keys: readonly string[]) {
  for (const id of [...asked.keys()]) {
    if (keys.some((key) => id.startsWith(`${key}\n`))) asked.delete(id);
  }
}
