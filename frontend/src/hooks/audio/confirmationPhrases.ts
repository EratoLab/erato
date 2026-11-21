import { env } from "@/app/env";
import {
  BUILT_IN_CONFIRMATION_PHRASES,
  confirmationPhraseOf,
} from "@/lib/toolCallGist/spokenLanguageData";

import type { ConfirmationPhrases } from "@/lib/toolCallGist/spokenLanguageData";

/**
 * The confirmation phrase of every language, as shown: the deployment's
 * checked phrases, else the built-in German and English ones.
 */
export const deploymentConfirmationPhrases = (): ConfirmationPhrases =>
  env().approvalVoicePhrases ?? BUILT_IN_CONFIRMATION_PHRASES;

/** The phrase a card in `language` approves with, if it has one. */
export const deploymentConfirmationPhrase = (
  language: string,
): string | undefined =>
  confirmationPhraseOf(language, deploymentConfirmationPhrases());
