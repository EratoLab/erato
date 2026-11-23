import { useEffect } from "react";
import { create } from "zustand";

import { fetchReplySpeechStyle } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useOptionalFeatureConfig } from "@/providers/FeatureConfigProvider";

import { applySpokenSettings } from "./speechPlayback";
import { refreshSpokenStyle } from "./spokenStyle";

/**
 * Whether the chat shows what the voice said in conversation mode (the
 * folded "Spoken" line and the replay button), as the backend resolves it
 * from the deployment, a supervisor's audience and the user's own choice.
 * Asked once the profile is known, so a reply streams with the right value;
 * hidden until the answer arrives and when it fails: hidden is the default.
 *
 * The same answer says whether replies are spoken (`applySpokenSettings`);
 * whether cards are read aloud is asked alongside (`refreshSpokenStyle`).
 * Both stay on until they are known.
 */
export const useVoiceTraces = create<{ shown: boolean }>(() => ({
  shown: false,
}));

const RETRY_AFTER_MS = 30_000;

let owner: string | undefined;
let generation = 0;
let pending: Promise<void> | null = null;
let answered = false;
let retryAt = 0;
/** The backend has no such endpoint (an older version): never asked again. */
let unsupported = false;

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : undefined;

const ask = (): Promise<void> => {
  if (pending) return pending;
  if (unsupported || Date.now() < retryAt) return Promise.resolve();
  // A later ask (a changed setting, another user) outdates this answer.
  const mine = ++generation;
  const replies = fetchReplySpeechStyle({})
    .then((style) => {
      if (mine !== generation) return;
      answered = true;
      useVoiceTraces.setState({ shown: style.show_in_chat });
      applySpokenSettings({ replies: style.spoken });
    })
    .catch((error: unknown) => {
      if (mine !== generation) return;
      if (statusOf(error) === 404) unsupported = true;
      else retryAt = Date.now() + RETRY_AFTER_MS;
    });
  // Cards keep being read aloud when only their answer fails.
  const cards = refreshSpokenStyle();
  pending = Promise.all([replies, cards])
    .then(() => {})
    .finally(() => {
      if (mine === generation) pending = null;
    });
  return pending;
};

/** Asks again, after the user changed the setting. */
export const refreshVoiceTraces = (): Promise<void> => {
  pending = null;
  answered = false;
  retryAt = 0;
  return ask();
};

/** Starts over for a signed-in user, so one user's value never shows for another. */
export const primeVoiceTraces = (userId: string): void => {
  if (owner === userId && (answered || pending)) return;
  if (owner !== userId) {
    owner = userId;
    unsupported = false;
    useVoiceTraces.setState({ shown: false });
    applySpokenSettings({ replies: true, cards: true });
  }
  void refreshVoiceTraces();
};

/** Asks for the value as soon as the user is known, where the voice can speak. */
export function usePrimeVoiceTraces(userId: string | undefined): void {
  const features = useOptionalFeatureConfig();
  const speech = Boolean(
    features?.audioConversational.enabled &&
      features.audioConversational.speechEnabled,
  );
  useEffect(() => {
    if (speech && userId) primeVoiceTraces(userId);
  }, [speech, userId]);
}

/** Only a message that has a trace to show asks; the answer is shared. */
export function useVoiceTracesShown(needed: boolean): boolean {
  const shown = useVoiceTraces((state) => state.shown);
  useEffect(() => {
    if (needed && !answered) void ask();
  }, [needed]);
  return needed && shown;
}
