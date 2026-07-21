import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_BODY_BYTES } from "../typescript/src/index.js";
import { MockSidecar, createMockSidecar } from "../test-server/src/index.js";

const ORIGIN = "https://app.erato.example";
const activeSidecars: MockSidecar[] = [];

afterEach(async () => {
  await Promise.all(activeSidecars.splice(0).map((sidecar) => sidecar.stop()));
});

describe("loopback HTTP policy", () => {
  it.each([
    ["an unconfigured Origin", { Origin: "https://attacker.example" }, 403],
    ["Origin: null", { Origin: "null" }, 403],
    ["an absent Origin", {}, 403],
    [
      "a DNS-rebinding-style Host",
      { Origin: ORIGIN, Host: "attacker.example" },
      421,
    ],
  ])("rejects %s", async (_name, headers, expectedStatus) => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);

    const response = await sendHttp(sidecar.address.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "request",
        method: "rpc.discover",
        params: {},
      }),
    });
    expect(response.status).toBe(expectedStatus);
  });

  it("answers a valid CORS private-network preflight without advancing protocol state", async () => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);

    const response = await sendHttp(sidecar.address.url, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
        "Access-Control-Request-Private-Network": "true",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(response.headers["access-control-allow-methods"]).toBe("POST");
    expect(response.headers["access-control-allow-headers"]).toBe(
      "Content-Type",
    );
    expect(response.headers["access-control-allow-private-network"]).toBe(
      "true",
    );
  });

  it("rejects unapproved preflight headers", async () => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);

    const response = await sendHttp(sidecar.address.url, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, authorization",
      },
    });

    expect(response.status).toBe(403);
  });

  it("rejects unsupported methods and content types", async () => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);

    await expect(
      sendHttp(sidecar.address.url, {
        method: "GET",
        headers: { Origin: ORIGIN },
      }),
    ).resolves.toMatchObject({ status: 405 });
    await expect(
      sendHttp(sidecar.address.url, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
        body: "{}",
      }),
    ).resolves.toMatchObject({ status: 415 });
  });

  it("rejects an oversized request before JSON-RPC processing", async () => {
    const sidecar = await createMockSidecar({ allowedOrigins: [ORIGIN] });
    activeSidecars.push(sidecar);

    const response = await sendHttp(sidecar.address.url, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: "x".repeat(MAX_BODY_BYTES + 1),
    });

    expect(response.status).toBe(413);
  });
});

interface HttpOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function sendHttp(url: string, options: HttpOptions): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: options.method, headers: options.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}
