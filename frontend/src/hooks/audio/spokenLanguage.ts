import { i18n } from "@lingui/core";
import { create } from "zustand";

import { catalogLoaded, loadCatalog } from "@/lib/i18n";
import { spokenWordsFor } from "@/lib/toolCallGist/spokenCardWords";

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
  // A card later in the turn is worded from this language's catalog, or
  // from English's where it has no card words.
  void loadCatalog(language);
  void loadCatalog("en");
}

/** Audio mode ended: a turn spoken but not sent belongs to no later message. */
export function dropUnsentSpokenLanguage() {
  useSpokenLanguage.setState({ unsent: undefined });
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

/** The language the voice speaks in this turn: the spoken one, else the person's. */
export function voiceTurnLanguage(): string {
  return spokenTurnLanguage() ?? mainLanguage();
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
  }).full && catalogLoaded(language);

/**
 * The language a spoken card is said in: the turn's when it has words for a
 * whole card, else the person's own, else English, each only with its
 * catalog loaded. With none of them, the person's own language says the
 * pointer sentence. A card is never half one language and half another.
 */
export function cardLanguage(turn: string | undefined): string {
  const main = mainLanguage();
  for (const language of [turn, main, "en"]) {
    if (language && saysWholeCard(language)) return language;
  }
  return main;
}

/** For tests. */
export function resetSpokenLanguage() {
  useSpokenLanguage.setState({ unsent: undefined, turn: undefined });
}
