/**
 * Downloads the OneDrive/SharePoint files shared into Teams messages. A
 * message carries only the file's web URL; the bytes resolve through the
 * `/shares` endpoint — encode the URL as a share token, read the driveItem for
 * its size and pre-authenticated download URL, then fetch that URL plain.
 *
 * Two-step on purpose: the driveItem's `size` lets an oversized file be
 * refused before a byte of it is downloaded.
 */

import { requestGraphJson } from "./teamsChatGraph";
import { GRAPH_BASE } from "../../utils/graph/graphClient";
import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";

import type { TeamsGraphCallOptions } from "./teamsChatGraph";
import type { GraphTokenSource } from "../../utils/graph/graphClient";

/** Files can dwarf messages; give the plain download more room than a page. */
const FILE_DOWNLOAD_TIMEOUT_MS = 30_000;

export interface TeamsSharedFileContent {
  bytes: ArrayBuffer;
  contentType: string;
}

export type TeamsSharedFileDownload =
  | { state: "ok"; content: TeamsSharedFileContent }
  /** Known too big from metadata — nothing was downloaded. */
  | { state: "too-large" }
  | { state: "error" };

/** `u!` + base64url of the web URL, per the `/shares` addressing contract. */
export function shareTokenForUrl(url: string): string {
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `u!${btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}

interface ShareDriveItem {
  name?: string;
  size?: number;
  file?: { mimeType?: string | null } | null;
  "@microsoft.graph.downloadUrl"?: string;
}

export async function downloadTeamsSharedFile(
  contentUrl: string,
  maxBytes: number,
  tokenSource: GraphTokenSource,
  options: TeamsGraphCallOptions = {},
): Promise<TeamsSharedFileDownload> {
  const item = await requestGraphJson<ShareDriveItem>({
    url: `${GRAPH_BASE}/shares/${shareTokenForUrl(contentUrl)}/driveItem?$select=name,size,file,@microsoft.graph.downloadUrl`,
    tokenSource,
    options,
  });
  if (!item.ok || !item.payload) return { state: "error" };
  // A shared folder has no file facet and nothing attachable.
  if (!item.payload.file) return { state: "error" };
  if ((item.payload.size ?? 0) > maxBytes) return { state: "too-large" };
  const downloadUrl = item.payload["@microsoft.graph.downloadUrl"];
  if (!downloadUrl) return { state: "error" };

  // The download URL is pre-authenticated: no Authorization header, and none
  // would survive the redirect to SharePoint anyway.
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);
  try {
    return await runWithGraphTimeout(
      FILE_DOWNLOAD_TIMEOUT_MS,
      `Shared file download timed out after ${FILE_DOWNLOAD_TIMEOUT_MS}ms`,
      options.signal,
      async (signal) => {
        const response = await transport(downloadUrl, { signal });
        if (!response.ok) return { state: "error" as const };
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > maxBytes) return { state: "too-large" as const };
        return {
          state: "ok" as const,
          content: {
            bytes,
            contentType:
              response.headers.get("Content-Type") ??
              item.payload?.file?.mimeType ??
              "application/octet-stream",
          },
        };
      },
    );
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    console.warn("[teamsSharedFilesGraph] download failed:", contentUrl, error);
    return { state: "error" };
  }
}
