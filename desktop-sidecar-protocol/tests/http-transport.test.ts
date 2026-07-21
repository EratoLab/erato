import { describe, expect, it, vi } from "vitest";

import {
  HttpTransport,
  MAX_BODY_BYTES,
  type SidecarFetch,
} from "../typescript/src/index.js";

describe("HttpTransport", () => {
  it("sends one credential-free JSON POST and returns its JSON body", async () => {
    const fetch = vi.fn<SidecarFetch>(async () =>
      jsonResponse('{"jsonrpc":"2.0","id":"c-1","result":{}}'),
    );
    const transport = new HttpTransport(
      "http://127.0.0.1:23123/erato/sidecar/rpc",
      { fetch },
    );

    await expect(transport.request('{"jsonrpc":"2.0"}')).resolves.toContain(
      '"result"',
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  });

  it("rejects transport-level HTTP errors", async () => {
    const transport = new HttpTransport("http://127.0.0.1:23123/rpc", {
      fetch: async () => new Response("", { status: 503 }),
    });

    await expect(transport.request("{}")).rejects.toMatchObject({
      kind: "transport_error",
    });
  });

  it("rejects a non-JSON response", async () => {
    const transport = new HttpTransport("http://127.0.0.1:23123/rpc", {
      fetch: async () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    });

    await expect(transport.request("{}")).rejects.toMatchObject({
      kind: "malformed_message",
    });
  });

  it("rejects oversized request and response bodies", async () => {
    const transport = new HttpTransport("http://127.0.0.1:23123/rpc", {
      fetch: async () => jsonResponse("x".repeat(MAX_BODY_BYTES + 1)),
    });

    await expect(
      transport.request("x".repeat(MAX_BODY_BYTES + 1)),
    ).rejects.toMatchObject({ kind: "malformed_message" });
    await expect(transport.request("{}")).rejects.toMatchObject({
      kind: "malformed_message",
    });
  });
});

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
