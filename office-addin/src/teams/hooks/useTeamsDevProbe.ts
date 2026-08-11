import { useEffect } from "react";

import { GRAPH_TEAMS_CHANNEL_SCOPES } from "./useTeamsChannelFetcher";
import { GRAPH_TEAMS_CHAT_SCOPES } from "./useTeamsChatFetcher";
import { useGraphTokenOptional } from "../../core/auth/GraphTokenProvider";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function decodeScopes(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.split("-").join("+").split("_").join("/");
    return (JSON.parse(atob(normalized)) as { scp?: string }).scp ?? "";
  } catch {
    return "";
  }
}

/**
 * Dev-only console surface for probing Graph with the add-in's real token,
 * including the raw search response our own reader filters. Storage scraping
 * cannot replace this: with NAA the host brokers tokens, so they are not
 * reliably left in this origin's storage.
 */
export function useTeamsDevProbe(): void {
  const graph = useGraphTokenOptional();

  useEffect(() => {
    if (!import.meta.env.DEV || !graph) return;

    const raw = async (
      path: string,
      init: RequestInit = {},
      scopes: string[] = GRAPH_TEAMS_CHAT_SCOPES,
    ) => {
      const token = await graph.acquireToken(scopes);
      const response = await fetch(`${GRAPH_BASE}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      };
    };

    const probe = {
      /** What Entra actually put in the token, versus what we asked for. */
      scopes: async () => {
        const chat = await graph.acquireToken(GRAPH_TEAMS_CHAT_SCOPES);
        const channel = await graph
          .acquireToken(GRAPH_TEAMS_CHANNEL_SCOPES)
          .catch((error: unknown) => `FAILED: ${String(error)}`);
        return {
          chatRequested: GRAPH_TEAMS_CHAT_SCOPES.join(" "),
          chatGranted: decodeScopes(chat),
          channelRequested: GRAPH_TEAMS_CHANNEL_SCOPES.join(" "),
          channelGranted:
            typeof channel === "string" && channel.startsWith("FAILED")
              ? channel
              : decodeScopes(channel),
        };
      },
      /** Unfiltered hits — our own reader drops anything without a chatId. */
      search: async (queryString: string, scopes?: string[]) => {
        const result = await raw(
          "/search/query",
          {
            method: "POST",
            body: JSON.stringify({
              requests: [
                {
                  entityTypes: ["chatMessage"],
                  query: { queryString },
                  from: 0,
                  size: 25,
                },
              ],
            }),
          },
          scopes ?? [...GRAPH_TEAMS_CHAT_SCOPES, ...GRAPH_TEAMS_CHANNEL_SCOPES],
        );
        const body = result.body as {
          value?: { hitsContainers?: { hits?: unknown[] }[] }[];
        } | null;
        const hits = body?.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
        console.log("status", result.status, "hits", hits.length);
        console.table(
          hits.map((hit) => {
            const resource = (hit as { resource?: Record<string, unknown> })
              .resource;
            return {
              id: resource?.id,
              chatId: resource?.chatId ?? "(none)",
              channelIdentity: JSON.stringify(resource?.channelIdentity),
              hasWebUrl: Boolean(resource?.webUrl),
              replyToId: resource?.replyToId ?? "(absent)",
            };
          }),
        );
        return hits;
      },
      channelMessage: (teamId: string, channelId: string, messageId: string) =>
        raw(
          `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
          {},
          GRAPH_TEAMS_CHANNEL_SCOPES,
        ),
      joinedTeams: () => raw("/me/joinedTeams", {}, GRAPH_TEAMS_CHANNEL_SCOPES),
      raw,
    };

    (globalThis as unknown as { __eratoTeams?: unknown }).__eratoTeams = probe;
    console.log(
      "[erato] __eratoTeams ready: scopes() | search(q) | joinedTeams() | channelMessage(teamId, channelId, id)",
    );

    return () => {
      delete (globalThis as unknown as { __eratoTeams?: unknown }).__eratoTeams;
    };
  }, [graph]);
}
