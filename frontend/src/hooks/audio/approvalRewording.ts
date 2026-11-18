import { useContext } from "react";

import { fetchRewordApproval } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  rewordingRequest,
  withRewording,
} from "@/lib/toolCallGist/spokenCardRewording";
import { useOptionalAudioConversationalFeature } from "@/providers/FeatureConfigProvider";
import { ProfileContext } from "@/providers/ProfileProvider";

import type { SpokenOptions, SpokenPiece } from "@/lib/toolCallGist/spokenCard";

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

const asked = new Map<string, Promise<SpokenPiece[]>>();

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
 * The card under `key` in the natural style: asked for once, then the same
 * answer however often it is needed. Resolves to `pieces` unchanged when
 * the backend is off, slow or fails.
 */
export function naturalApprovalPieces(
  key: string,
  messageId: string,
  pieces: SpokenPiece[],
  options: Pick<SpokenOptions, "language" | "now" | "timeZone">,
): Promise<SpokenPiece[]> {
  const known = asked.get(key);
  if (known) return known;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);
  const request = rewordingRequest(pieces, options);
  const answer = fetchRewordApproval(
    {
      pathParams: { messageId },
      body: {
        language: request.language,
        pieces: request.pieces,
      },
    },
    abort.signal,
  )
    .then((reworded) => withRewording(pieces, reworded.pieces))
    .catch(() => pieces)
    .finally(() => clearTimeout(timer));
  asked.set(key, answer);
  return answer;
}

/** Forgets the answers for cards that no longer wait. */
export function forgetNaturalApprovals(keys: readonly string[]) {
  for (const key of keys) asked.delete(key);
}
