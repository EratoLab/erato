import { i18n } from "@lingui/core";
import { create } from "zustand";

import { catalogLoaded, loadCatalog } from "@/lib/i18n";
import { spokenWordsFor } from "@/lib/toolCallGist/spokenCardWords";
import { primaryLanguage } from "@/lib/toolCallGist/spokenLanguageData";

import { deploymentSpokenCardLanguages } from "./spokenStyle";

/**
 * The language the user speaks in conversational audio mode, as the backend
 * decided it for each turn. Everything the voice says in a turn follows it;
 * the interface and the card on screen stay in the interface language.
 */
interface SpokenLanguageState {
  /** Decided for the turn just spoken, until that turn is sent. */
  unsent?: string;
  /** The language of the turn the voice answers now, or answered last. */
  turn?: string;
}

export const useSpokenLanguage = create<SpokenLanguageState>(() => ({}));

/** The backend decided the language of the conversational turn just spoken. */
export function noteSpokenTurnLanguage(language: string) {
  useSpokenLanguage.setState({ unsent: language });
  // A card later in the turn is worded from this language's catalog.
  void loadCatalog(language);
}

/**
 * The language the message sent now was spoken in, if it was. From here on
 * the voice speaks it; a message that was typed keeps the last one.
 */
export function takeSpokenTurnLanguage(): string | undefined {
  const { unsent, turn } = useSpokenLanguage.getState();
  useSpokenLanguage.setState({ unsent: undefined, turn: unsent ?? turn });
  return unsent;
}

/** The language of the turn the voice answers, if one was spoken. */
export function spokenTurnLanguage(): string | undefined {
  return useSpokenLanguage.getState().turn;
}

/**
 * The person's own language, for what the spoken language has no words for.
 * The interface language, which the page also stores as the profile's.
 */
export function mainLanguage(): string {
  return i18n.locale;
}

/** Whether `language` has words for a whole card and its sentences are loaded. */
const saysWholeCard = (language: string) =>
  spokenWordsFor(language, {
    now: new Date(),
    spokenCardLanguages: deploymentSpokenCardLanguages(),
  }).full &&
  (primaryLanguage(language) === primaryLanguage(i18n.locale) ||
    catalogLoaded(primaryLanguage(language)));

/**
 * The language a spoken card is said in: the turn's when it has words for a
 * whole card, else the person's own, else English. A card is never half one
 * language and half another.
 */
export function cardLanguage(turn: string | undefined): string {
  for (const language of [turn, mainLanguage()]) {
    if (language && saysWholeCard(language)) return language;
  }
  return "en";
}

/** For tests. */
export function resetSpokenLanguage() {
  useSpokenLanguage.setState({ unsent: undefined, turn: undefined });
}
