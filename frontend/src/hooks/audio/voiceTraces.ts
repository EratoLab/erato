import { useEffect } from "react";
import { create } from "zustand";

import { fetchReplySpeechStyle } from "@/lib/generated/v1betaApi/v1betaApiComponents";

/**
 * Whether the chat shows what the voice said in conversation mode (the
 * folded "Spoken" line and the replay button), as the backend resolves it
 * from the deployment, a supervisor's audience and the user's own choice.
 * Hidden until the answer arrives, and when the request fails: hidden is
 * the default.
 */
export const useVoiceTraces = create<{ shown: boolean }>(() => ({
  shown: false,
}));

let asked: Promise<void> | null = null;
let answered = false;

const ask = (): Promise<void> => {
  asked ??= fetchReplySpeechStyle({})
    .then((style) => {
      useVoiceTraces.setState({ shown: style.show_in_chat });
    })
    .catch(() => undefined)
    .finally(() => {
      answered = true;
      asked = null;
    });
  return asked;
};

/** Asks again, after the user changed the setting. */
export const refreshVoiceTraces = (): Promise<void> => {
  answered = false;
  return ask();
};

/** Only a message that has a trace to show asks; the answer is shared. */
export function useVoiceTracesShown(needed: boolean): boolean {
  const shown = useVoiceTraces((state) => state.shown);
  useEffect(() => {
    if (needed && !answered) void ask();
  }, [needed]);
  return needed && shown;
}
