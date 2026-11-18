import { useEffect, useState } from "react";

import { env } from "@/app/env";
import { fetchApprovalSpeechStyle } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ApprovalSpeechStyleResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenOptions } from "@/lib/toolCallGist/spokenCard";
import type { SentenceSet } from "@/lib/toolCallGist/spokenSentences";

/**
 * How waiting approval cards are read aloud for this user: how much is said
 * and how it is worded, as the backend resolves it from the deployment, a
 * supervisor's audience and the user's own choice. Asked once per page; until
 * it arrives, or if it fails, cards are read as today (full, precise).
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

const fromResponse = (style: ApprovalSpeechStyleResponse): SpokenStyle => ({
  amount: style.amount === "short" ? "short" : "full",
  shortDetails: style.short_details,
  wording: style.wording === "natural" ? "natural" : "precise",
});

const ask = (): Promise<SpokenStyle> => {
  asked ??= fetchApprovalSpeechStyle({})
    .then((style) => (known = fromResponse(style)))
    .catch(() => {
      asked = null;
      return TODAY;
    });
  return asked;
};

/** Asks again, after the user changed their own choice. */
export const forgetSpokenStyle = () => {
  asked = null;
  known = null;
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
