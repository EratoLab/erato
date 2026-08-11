import { describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../../../test/mocks/teams/graph";
import { makeGraphTokenSource } from "../../../utils/graph/graphClient";
import {
  downloadTeamsSharedFile,
  shareTokenForUrl,
} from "../teamsSharedFilesGraph";

import type { GraphTransport } from "../../../utils/graph/graphClient";

const tokenSource = () => makeGraphTokenSource(async () => "token");

const CONTENT_URL = "https://contoso.sharepoint.com/sites/x/Q3%20Plan.docx";

function binaryResponse(text: string, contentType: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "",
    headers: {
      get: (name: string) => (name === "Content-Type" ? contentType : null),
    },
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer),
  } as unknown as Response;
}

function driveItemResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    name: "Q3 Plan.docx",
    size: 1234,
    file: { mimeType: "application/vnd.openxmlformats" },
    "@microsoft.graph.downloadUrl": "https://download.example/tempauth",
    ...overrides,
  });
}

describe("shareTokenForUrl", () => {
  it("encodes to the u! base64url form and decodes back to the url", () => {
    const token = shareTokenForUrl(CONTENT_URL);
    expect(token.startsWith("u!")).toBe(true);
    expect(token).not.toMatch(/[+/=]/);
    const base64 = token
      .slice(2)
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil((token.length - 2) / 4) * 4, "=");
    expect(atob(base64)).toBe(CONTENT_URL);
  });
});

describe("downloadTeamsSharedFile", () => {
  it("resolves the share, then downloads pre-authenticated without a token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport: GraphTransport = vi.fn(
      (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          url.includes("/shares/")
            ? driveItemResponse()
            : binaryResponse("pdf-bytes", "application/pdf"),
        );
      },
    );

    const result = await downloadTeamsSharedFile(
      CONTENT_URL,
      10_000,
      tokenSource(),
      { transport },
    );

    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    expect(new TextDecoder().decode(result.content.bytes)).toBe("pdf-bytes");
    expect(result.content.contentType).toBe("application/pdf");

    expect(calls[0].url).toBe(
      `https://graph.microsoft.com/v1.0/shares/${shareTokenForUrl(CONTENT_URL)}/driveItem?$select=name,size,file,@microsoft.graph.downloadUrl`,
    );
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer token");
    expect(calls[1].url).toBe("https://download.example/tempauth");
    expect(calls[1].init?.headers ?? {}).not.toHaveProperty("Authorization");
  });

  it("refuses an oversized file from metadata without downloading a byte", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(driveItemResponse({ size: 50_000 })),
    );

    const result = await downloadTeamsSharedFile(
      CONTENT_URL,
      10_000,
      tokenSource(),
      { transport },
    );

    expect(result).toEqual({ state: "too-large" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("treats a shared folder as unattachable", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(driveItemResponse({ file: null })),
    );

    const result = await downloadTeamsSharedFile(
      CONTENT_URL,
      10_000,
      tokenSource(),
      { transport },
    );

    expect(result).toEqual({ state: "error" });
  });

  it("degrades to an error state when the share cannot be resolved", async () => {
    const transport = vi.fn(() => Promise.resolve(jsonResponse({}, 403)));

    const result = await downloadTeamsSharedFile(
      CONTENT_URL,
      10_000,
      tokenSource(),
      { transport },
    );

    expect(result).toEqual({ state: "error" });
  });
});
