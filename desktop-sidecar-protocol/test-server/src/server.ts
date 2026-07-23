import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  MAX_BODY_BYTES,
  type CapabilityDescriptor,
  type DiscoverParams,
  type DiscoveryDocument,
} from "../../typescript/src/index.js";
import {
  validateCancelParams,
  validateDiagnosticsEchoV1Params,
  validateDiscoverParams,
  validateOutlookListEmailsV1Params,
  validateOutlookListMailboxesV1Params,
  validateSidecarRestartV1Params,
} from "../../typescript/src/generated/validators.mjs";

import type { AddressInfo } from "node:net";

export interface MockSidecarOptions {
  host?: string;
  port?: number;
  path?: string;
  allowedOrigins: readonly string[];
  supportedProtocolVersions?: readonly string[];
  capabilityAvailability?: "enabled" | "disabled";
  capabilityReasonCode?: string;
  catalogueDigestOverride?: string;
  echoDelayMs?: number;
  echoResultOverride?: unknown;
}

export interface MockSidecarAddress {
  host: string;
  port: number;
  path: string;
  url: string;
}

interface RequestMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
  "x-erato-deadline-at"?: string;
}

interface HttpRejection {
  status: number;
  reason: string;
}

const INSTANCE_ID = "mock-sidecar-instance";
const MOCK_OUTLOOK_MAILBOX = {
  id: "8b7d2f4a6c9e1035d8a1b2c3e4f50617",
  displayName: "Mock Outlook mailbox",
  emailAddress: "mock@example.com",
  profileName: "Mock Outlook Profile",
  source: "mock",
};
const MOCK_OUTLOOK_EMAIL = {
  id: "mock-outlook-email",
  subject: "Mock Outlook message",
  senderName: "Erato Test",
  senderEmailAddress: "test@example.com",
  receivedAtUnixSeconds: 1_774_291_200,
  internetMessageId: "<mock-outlook-email@example.com>",
};
const openRpcUrl = [
  new URL("../../openrpc.json", import.meta.url),
  new URL("../../../openrpc.json", import.meta.url),
].find((candidate) => existsSync(candidate));
if (!openRpcUrl)
  throw new Error("Could not locate the canonical openrpc.json.");
const canonicalOpenRpc = JSON.parse(
  readFileSync(openRpcUrl, "utf8"),
) as DiscoveryDocument;

export class MockSidecar {
  readonly #options: Required<
    Pick<
      MockSidecarOptions,
      "host" | "port" | "path" | "supportedProtocolVersions" | "echoDelayMs"
    >
  > &
    MockSidecarOptions;
  readonly #allowedOrigins: Set<string>;
  readonly #inFlight = new Map<string, AbortController>();
  readonly #httpServer = createServer((request, response) => {
    void this.#handleHttpRequest(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
      } else {
        this.#sendHttpError(response, 500, "Internal Server Error");
      }
    });
  });
  #address: MockSidecarAddress | undefined;
  #catalogueRevision = 1;
  #capabilityAvailability: "enabled" | "disabled";
  #capabilityReasonCode: string | undefined;
  #restartRequests = 0;

  constructor(options: MockSidecarOptions) {
    if (options.allowedOrigins.length === 0) {
      throw new Error(
        "The mock sidecar requires at least one exact allowed Origin.",
      );
    }
    this.#options = {
      ...options,
      host: options.host ?? "127.0.0.1",
      port: options.port ?? 0,
      path: options.path ?? "/erato/sidecar/rpc",
      supportedProtocolVersions: options.supportedProtocolVersions ?? ["1.0"],
      echoDelayMs: options.echoDelayMs ?? 0,
    };
    this.#allowedOrigins = new Set(options.allowedOrigins.map(normalizeOrigin));
    this.#capabilityAvailability = options.capabilityAvailability ?? "enabled";
    this.#capabilityReasonCode = options.capabilityReasonCode;
  }

  get address(): MockSidecarAddress {
    if (!this.#address)
      throw new Error("The mock sidecar has not been started.");
    return this.#address;
  }

  get restartRequests(): number {
    return this.#restartRequests;
  }

  async start(): Promise<MockSidecarAddress> {
    if (this.#address) return this.#address;
    await new Promise<void>((resolve, reject) => {
      this.#httpServer.once("error", reject);
      this.#httpServer.listen(this.#options.port, this.#options.host, () => {
        this.#httpServer.off("error", reject);
        resolve();
      });
    });
    const address = this.#httpServer.address() as AddressInfo;
    this.#address = {
      host: this.#options.host,
      port: address.port,
      path: this.#options.path,
      url: `http://${this.#options.host}:${address.port}${this.#options.path}`,
    };
    return this.#address;
  }

  async stop(): Promise<void> {
    for (const controller of this.#inFlight.values()) controller.abort();
    this.#inFlight.clear();
    this.#httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.#httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    this.#address = undefined;
  }

  setCapabilityAvailability(
    availability: "enabled" | "disabled",
    reasonCode?: string,
  ): void {
    if (availability === "disabled" && !reasonCode) {
      throw new Error("Disabled capabilities require a stable reason code.");
    }
    this.#capabilityAvailability = availability;
    this.#capabilityReasonCode = reasonCode;
    this.#catalogueRevision += 1;
  }

  async #handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const validation = this.#validateHttpRequest(request);
    if (typeof validation !== "string") {
      this.#sendHttpError(response, validation.status, validation.reason);
      return;
    }
    const origin = validation;

    if (request.method === "OPTIONS") {
      this.#handlePreflight(request, response, origin);
      return;
    }
    if (request.method !== "POST") {
      this.#sendHttpError(response, 405, "Method Not Allowed", origin);
      return;
    }
    const contentType = request.headers["content-type"];
    if (
      typeof contentType !== "string" ||
      contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    ) {
      this.#sendHttpError(response, 415, "Unsupported Media Type", origin);
      return;
    }

    let body: string;
    try {
      body = await readRequestBody(request, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        this.#sendHttpError(response, 413, "Content Too Large", origin);
      } else {
        this.#sendHttpError(response, 400, "Bad Request", origin);
      }
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      this.#sendJsonRpcError(response, origin, null, -32700, "Parse error.");
      return;
    }
    if (!isRequestMessage(message)) {
      this.#sendJsonRpcError(
        response,
        origin,
        null,
        -32600,
        "Invalid request.",
      );
      return;
    }
    if (message.id === undefined) {
      this.#sendEmpty(response, 204, origin);
      return;
    }

    const rpcResponse = await this.#handleRpcRequest(
      origin,
      message as RequestMessage & { id: string | number },
    );
    this.#sendJson(response, origin, rpcResponse);
  }

  #validateHttpRequest(request: IncomingMessage): string | HttpRejection {
    if (!this.#address) return { status: 503, reason: "Not Ready" };
    if (request.url !== this.#address.path) {
      return { status: 404, reason: "Not Found" };
    }
    const expectedHost = `${this.#address.host}:${this.#address.port}`;
    if (request.headers.host !== expectedHost) {
      return { status: 421, reason: "Misdirected Request" };
    }
    const rawOrigin = request.headers.origin;
    if (!rawOrigin || rawOrigin === "null") {
      return { status: 403, reason: "Forbidden" };
    }
    let origin: string;
    try {
      origin = normalizeOrigin(rawOrigin);
    } catch {
      return { status: 403, reason: "Forbidden" };
    }
    return this.#allowedOrigins.has(origin)
      ? origin
      : { status: 403, reason: "Forbidden" };
  }

  #handlePreflight(
    request: IncomingMessage,
    response: ServerResponse,
    origin: string,
  ): void {
    if (request.headers["access-control-request-method"] !== "POST") {
      this.#sendHttpError(response, 405, "Method Not Allowed", origin);
      return;
    }
    const requestedHeaders = (
      request.headers["access-control-request-headers"] ?? ""
    )
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => header !== "content-type")) {
      this.#sendHttpError(response, 403, "Forbidden", origin);
      return;
    }
    this.#setCorsHeaders(response, origin);
    response.setHeader("Access-Control-Allow-Methods", "POST");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.headers["access-control-request-private-network"] === "true") {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    response.setHeader("Connection", "close");
    response.writeHead(204).end();
  }

  async #handleRpcRequest(
    origin: string,
    message: RequestMessage & { id: string | number },
  ): Promise<unknown> {
    if (message.method === "rpc.discover") {
      if (!validateDiscoverParams(message.params)) {
        return rpcError(message.id, -32602, "Invalid discovery parameters.");
      }
      const params = message.params as DiscoverParams;
      const protocolVersion = params.protocolVersions.find((version) =>
        this.#options.supportedProtocolVersions.includes(version),
      );
      if (!protocolVersion) {
        return rpcError(
          message.id,
          -32010,
          "No mutually supported protocol version.",
          {
            kind: "incompatible_protocol",
            supportedProtocolVersions: this.#options.supportedProtocolVersions,
          },
        );
      }
      return rpcResult(message.id, {
        protocolVersion,
        serverInfo: { name: "erato-mock-sidecar", version: "0.1.0" },
        instanceId: INSTANCE_ID,
        document: this.#discoveryDocument(),
      });
    }

    if (message.method === "erato.cancel") {
      if (!validateCancelParams(message.params)) {
        return rpcError(message.id, -32602, "Invalid cancellation parameters.");
      }
      const requestId = (message.params as { requestId: string | number })
        .requestId;
      const controller = this.#inFlight.get(requestKey(origin, requestId));
      controller?.abort();
      return rpcResult(message.id, { accepted: controller !== undefined });
    }

    if (message.method === "sidecar.restart.v1") {
      if (!validateSidecarRestartV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      this.#restartRequests += 1;
      return rpcResult(message.id, { accepted: true });
    }

    if (message.method === "outlook.list_mailboxes.v1") {
      if (!validateOutlookListMailboxesV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      return rpcResult(message.id, {
        mailboxes: [MOCK_OUTLOOK_MAILBOX],
        warnings: [],
      });
    }

    if (message.method === "outlook.list_emails.v1") {
      if (!validateOutlookListEmailsV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      if (
        (message.params as { mailboxId: string }).mailboxId !==
        MOCK_OUTLOOK_MAILBOX.id
      ) {
        return rpcError(message.id, -32602, "Unknown Outlook mailbox.");
      }
      return rpcResult(message.id, {
        mailbox: MOCK_OUTLOOK_MAILBOX,
        emails: [MOCK_OUTLOOK_EMAIL],
      });
    }

    if (message.method !== "diagnostics.echo.v1") {
      return rpcError(message.id, -32601, "Method not found.");
    }
    if (this.#capabilityAvailability !== "enabled") {
      return rpcError(
        message.id,
        -32011,
        "The requested capability is unavailable.",
        {
          kind: "capability_unavailable",
          method: message.method,
          reasonCode: this.#capabilityReasonCode,
        },
      );
    }
    if (!validateDiagnosticsEchoV1Params(message.params)) {
      return rpcError(message.id, -32602, "Invalid method parameters.");
    }
    if (
      message["x-erato-deadline-at"] &&
      Date.parse(message["x-erato-deadline-at"]) <= Date.now()
    ) {
      return rpcError(message.id, -32015, "The request timed out.", {
        kind: "timeout",
        requestId: message.id,
      });
    }

    const key = requestKey(origin, message.id);
    if (this.#inFlight.has(key)) {
      return rpcError(message.id, -32600, "Duplicate pending request ID.");
    }
    const controller = new AbortController();
    this.#inFlight.set(key, controller);
    try {
      if (this.#options.echoDelayMs > 0) {
        await abortableDelay(this.#options.echoDelayMs, controller.signal);
      }
      if (controller.signal.aborted) {
        return rpcError(message.id, -32014, "The request was cancelled.", {
          kind: "request_cancelled",
          requestId: message.id,
        });
      }
      return rpcResult(
        message.id,
        this.#options.echoResultOverride ?? {
          message: (message.params as { message: string }).message,
          sidecarInstanceId: INSTANCE_ID,
        },
      );
    } finally {
      this.#inFlight.delete(key);
    }
  }

  #discoveryDocument(): DiscoveryDocument {
    const document = structuredClone(canonicalOpenRpc);
    const echoMethod = document.methods.find(
      (method) => method.name === "diagnostics.echo.v1",
    );
    if (!echoMethod?.["x-erato-capability"]) {
      throw new Error(
        "The canonical catalogue is missing diagnostics.echo.v1.",
      );
    }
    const descriptor = echoMethod["x-erato-capability"] as CapabilityDescriptor;
    descriptor.availability =
      this.#capabilityAvailability === "enabled"
        ? { state: "enabled" }
        : {
            state: "disabled",
            reasonCode: this.#capabilityReasonCode ?? "organization_policy",
          };
    document["x-erato-catalogue"] = {
      revision: String(this.#catalogueRevision),
      digest: "sha256:pending",
    };
    document["x-erato-catalogue"].digest =
      this.#options.catalogueDigestOverride ?? catalogueDigest(document);
    return document;
  }

  #sendJsonRpcError(
    response: ServerResponse,
    origin: string,
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    this.#sendJson(response, origin, rpcError(id, code, message, data));
  }

  #sendJson(response: ServerResponse, origin: string, message: unknown): void {
    const body = JSON.stringify(message);
    this.#setCorsHeaders(response, origin);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Content-Length", Buffer.byteLength(body));
    response.writeHead(200).end(body);
  }

  #sendEmpty(response: ServerResponse, status: number, origin: string): void {
    this.#setCorsHeaders(response, origin);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.writeHead(status).end();
  }

  #sendHttpError(
    response: ServerResponse,
    status: number,
    reason: string,
    origin?: string,
  ): void {
    if (origin) this.#setCorsHeaders(response, origin);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    response.writeHead(status, reason).end();
  }

  #setCorsHeaders(response: ServerResponse, origin: string): void {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader(
      "Vary",
      "Origin, Access-Control-Request-Private-Network",
    );
  }
}

export async function createMockSidecar(
  options: MockSidecarOptions,
): Promise<MockSidecar> {
  const sidecar = new MockSidecar(options);
  await sidecar.start();
  return sidecar;
}

class BodyTooLargeError extends Error {}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maximumBytes) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin === "null" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Origin must be an exact hierarchical origin: ${value}`);
  }
  return url.origin;
}

function isRequestMessage(value: unknown): value is RequestMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.jsonrpc === "2.0" &&
    typeof record.method === "string" &&
    (record.id === undefined ||
      typeof record.id === "string" ||
      typeof record.id === "number")
  );
}

function rpcResult(id: string | number, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function requestKey(origin: string, requestId: string | number): string {
  return `${origin}\u0000${String(requestId)}`;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function catalogueDigest(document: DiscoveryDocument): string {
  const digestInput = structuredClone(document);
  delete (digestInput["x-erato-catalogue"] as { digest?: string }).digest;
  return `sha256:${createHash("sha256")
    .update(canonicalJson(digestInput), "utf8")
    .digest("hex")}`;
}
