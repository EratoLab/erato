import { useEffect } from "react";

import { GRAPH_TEAMS_CHANNEL_SCOPES } from "./useTeamsChannelFetcher";
import { GRAPH_TEAMS_CHAT_SCOPES } from "./useTeamsChatFetcher";
import { GRAPH_TEAMS_FILE_SCOPES } from "./useTeamsFileFetcher";
import { useGraphTokenOptional } from "../../core/auth/GraphTokenProvider";
import { makeGraphTokenSource } from "../../utils/graph/graphClient";
import {
  downloadTeamsSharedFile,
  shareTokenForUrl,
} from "../utils/teamsSharedFilesGraph";
import {
  MAX_SHARED_FILE_BYTES,
  MAX_IMAGE_BYTES,
} from "../utils/teamsTranscriptAssets";

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
      /** Is `Files.Read.All` actually in the token this tenant hands out? */
      fileScopes: async () => {
        const token = await graph
          .acquireToken(GRAPH_TEAMS_FILE_SCOPES)
          .catch((error: unknown) => `FAILED: ${String(error)}`);
        return token.startsWith("FAILED")
          ? { requested: GRAPH_TEAMS_FILE_SCOPES.join(" "), granted: token }
          : {
              requested: GRAPH_TEAMS_FILE_SCOPES.join(" "),
              granted: decodeScopes(token),
            };
      },
      /** The `/shares` metadata leg alone — does the driveItem resolve? */
      share: (contentUrl: string) =>
        raw(
          `/shares/${shareTokenForUrl(contentUrl)}/driveItem`,
          {},
          GRAPH_TEAMS_FILE_SCOPES,
        ),
      /** The full download — the decisive CORS test for the tempauth URL. */
      download: async (contentUrl: string) => {
        const result = await downloadTeamsSharedFile(
          contentUrl,
          MAX_SHARED_FILE_BYTES,
          makeGraphTokenSource((options) =>
            graph.acquireToken(GRAPH_TEAMS_FILE_SCOPES, options),
          ),
        );
        return result.state === "ok"
          ? {
              state: result.state,
              byteLength: result.content.bytes.byteLength,
              contentType: result.content.contentType,
            }
          : result;
      },
      /** A hosted image by its body URL; pass channel scopes for channels. */
      image: async (url: string, scopes?: string[]) => {
        const token = await graph.acquireToken(
          scopes ?? GRAPH_TEAMS_CHAT_SCOPES,
        );
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const bytes = response.ok ? await response.arrayBuffer() : null;
        return {
          status: response.status,
          byteLength: bytes?.byteLength ?? null,
          contentType: response.headers.get("Content-Type"),
          overCap: (bytes?.byteLength ?? 0) > MAX_IMAGE_BYTES,
        };
      },
      raw,
    };

    (globalThis as unknown as { __eratoTeams?: unknown }).__eratoTeams = probe;
    console.log(
      "[erato] __eratoTeams ready: scopes() | fileScopes() | search(q) | joinedTeams() | channelMessage(teamId, channelId, id) | share(contentUrl) | download(contentUrl) | image(url, scopes?)",
    );

    return () => {
      delete (globalThis as unknown as { __eratoTeams?: unknown }).__eratoTeams;
    };
  }, [graph]);
}
