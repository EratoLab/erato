import { useCallback, useState } from "react";

import { parseTeamsMessage } from "../utils/parsedTeamsChat";
import { conversationKey } from "../utils/teamsConversationRef";

import type { ParsedTeamsMessage } from "../utils/parsedTeamsChat";
import type { TeamsChannelFetcher } from "../utils/teamsChatFetcher";
import type { TeamsChannelConversationRef } from "../utils/teamsConversationRef";

export type TeamsChannelHitProbe =
  | { state: "probing" }
  | {
      state: "root";
      /** The probe response, parsed; null when nothing renderable survived. */
      message: ParsedTeamsMessage | null;
    }
  | { state: "reply" }
  | { state: "failed" };

export function channelHitKey(
  ref: TeamsChannelConversationRef,
  messageId: string,
): string {
  return `${conversationKey(ref)}:${messageId}`;
}

/**
 * Resolves whether a channel search hit is a thread root before it becomes
 * selectable. A reply hit is indistinguishable from a root hit — no
 * `replyToId`, no parent in its link — so the one gated GET here is the only
 * way to learn the placement, and running it at tick time turns what would be
 * a 404 during the attach into an answer the user can act on.
 */
export function useTeamsChannelHitProbe(fetcher: TeamsChannelFetcher | null): {
  probeFor: (
    ref: TeamsChannelConversationRef,
    messageId: string,
  ) => TeamsChannelHitProbe | undefined;
  probe: (
    ref: TeamsChannelConversationRef,
    messageId: string,
  ) => Promise<TeamsChannelHitProbe>;
} {
  const [probes, setProbes] = useState<
    ReadonlyMap<string, TeamsChannelHitProbe>
  >(new Map());

  const put = useCallback((key: string, value: TeamsChannelHitProbe) => {
    setProbes((current) => new Map(current).set(key, value));
  }, []);

  const probe = useCallback(
    async (
      ref: TeamsChannelConversationRef,
      messageId: string,
    ): Promise<TeamsChannelHitProbe> => {
      const key = channelHitKey(ref, messageId);
      if (!fetcher) return { state: "failed" };
      put(key, { state: "probing" });
      const result = await fetcher
        .probeMessage(ref.teamId, ref.channelId, messageId, {})
        .catch(() => null);
      const next: TeamsChannelHitProbe = result?.message
        ? {
            state: "root",
            message: parseTeamsMessage(
              result.message,
              `${ref.teamId}/${ref.channelId}`,
            ),
          }
        : result?.status === 404
          ? { state: "reply" }
          : { state: "failed" };
      put(key, next);
      return next;
    },
    [fetcher, put],
  );

  const probeFor = useCallback(
    (ref: TeamsChannelConversationRef, messageId: string) =>
      probes.get(channelHitKey(ref, messageId)),
    [probes],
  );

  return { probeFor, probe };
}
