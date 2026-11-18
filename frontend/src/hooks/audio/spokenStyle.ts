import { useEffect, useState } from "react";

import { env } from "@/app/env";
import { fetchApprovalSpeechStyle } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ApprovalSpeechStyleResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenOptions } from "@/lib/toolCallGist/spokenCard";
import type { SentenceSet } from "@/lib/toolCallGist/spokenSentences";

/**
 * How waiting approval cards are read aloud for this user: how much is said
 * and how it is worded, as the backend resolves it from the deployment, a
 * supervisor's audience and the user's own choice. Asked again for each card
 * that may be spoken, so a changed style applies from the next card on; the
 * last answer stands in meanwhile. Until the first answer arrives, or if it
 * fails, cards are read as today (full, precise).
 */
export type SpokenStyle = Pick<
  SpokenOptions,
  "amount" | "shortDetails" | "wording"
>;

const TODAY: SpokenStyle = {
  amount: "full",
  shortDetails: 1,
  wording: "precise",
};

let asked: Promise<SpokenStyle> | null = null;
let known: SpokenStyle | null = null;
/** The backend has no such endpoint (an older version): never asked again. */
let unsupported = false;

const fromResponse = (style: ApprovalSpeechStyleResponse): SpokenStyle => ({
  amount: style.amount === "short" ? "short" : "full",
  shortDetails: style.short_details,
  wording: style.wording === "natural" ? "natural" : "precise",
});

const statusOf = (error: unknown): number | undefined =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : undefined;

/** One request at a time; a card that mounts while one runs shares it. */
const ask = (): Promise<SpokenStyle> => {
  if (unsupported) return Promise.resolve(known ?? TODAY);
  asked ??= fetchApprovalSpeechStyle({})
    .then((style) => (known = fromResponse(style)))
    .catch((error: unknown) => {
      if (statusOf(error) === 404) unsupported = true;
      return known ?? TODAY;
    })
    .finally(() => {
      asked = null;
    });
  return asked;
};

/** Forgets the last answer: the next card waits for a fresh one. */
export const forgetSpokenStyle = () => {
  asked = null;
  known = null;
  unsupported = false;
};

export function useSpokenStyle(enabled: boolean): SpokenStyle {
  const [style, setStyle] = useState<SpokenStyle>(known ?? TODAY);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void ask().then((resolved) => {
      if (current) setStyle(resolved);
    });
    return () => {
      current = false;
    };
  }, [enabled]);
  return style;
}

/** The deployment's natural sentence variants for `language`. */
export const deploymentSentences = (
  language: string,
): SentenceSet | undefined => {
  const all = env().approvalSpeechSentences;
  const code = language.split(/[-_]/)[0]?.toLowerCase() ?? "en";
  return all?.[language] ?? all?.[code];
};
