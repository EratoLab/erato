import { SidecarClientError, SidecarRpcError } from "./errors.js";
import {
  validateCancelResult,
  validateDiagnosticsEchoV1Params,
  validateDiagnosticsEchoV1Result,
  validateDiscoverResult,
  validateJsonRpcEnvelope,
  validateOutlookGetConversationV1Params,
  validateOutlookGetConversationV1Result,
  validateOutlookListEmailsV1Params,
  validateOutlookListEmailsV1Result,
  validateOutlookListMailboxesV1Params,
  validateOutlookListMailboxesV1Result,
  validateSidecarProgressV1Params,
  validateSidecarProgressV1Result,
  validateSidecarRestartV1Params,
  validateSidecarRestartV1Result,
  validateSidecarConfigureV1Params,
  validateSidecarConfigureV1Result,
  type Validator,
} from "./generated/validators.mjs";

import type {
  CapabilityDescriptor,
  DiagnosticsEchoV1Params,
  DiagnosticsEchoV1Result,
  DiscoverParams,
  DiscoverResult,
  DiscoveryDocument,
  OutlookGetConversationV1Params,
  OutlookGetConversationV1Result,
  OutlookListEmailsV1Params,
  OutlookListEmailsV1Result,
  OutlookListMailboxesV1Params,
  OutlookListMailboxesV1Result,
  SidecarProgressV1Params,
  SidecarProgressV1Result,
  SidecarRestartV1Params,
  SidecarRestartV1Result,
  SidecarConfigureV1Params,
  SidecarConfigureV1Result,
} from "./generated/index.js";
import type { SidecarTransport } from "./transport.js";

export const PROTOCOL_VERSIONS = ["1.0"] as const;
export const MAX_BODY_BYTES = 262_144;
/**
 * Cap for response bodies. Far larger than the request cap because
 * `outlook.get_conversation.v1` carries a whole thread's message bodies and
 * attachment bytes inline (base64). The trusted local sidecar is the only
 * writer, so this bounds memory rather than an untrusted peer. Override with
 * `maxResponseBytes` when a deployment needs larger threads.
 */
export const MAX_RESPONSE_BYTES = 67_108_864;

export interface SidecarClientInfo {
  name: string;
  version: string;
  host: {
    application: string;
    applicationVersion?: string;
    runtime: string;
    runtimeVersion?: string;
  };
  os: {
    name: string;
    version?: string;
    architecture?: string;
  };
}

export type SidecarReadinessState =
  | "unavailable"
  | "discovering"
  | "ready"
  | "error";

export interface SidecarCapability {
  id: string;
  major: number;
  method: string;
  availability: "enabled" | "disabled" | "unknown";
  reasonCode?: string;
}

export interface SidecarSnapshot {
  state: SidecarReadinessState;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string } | null;
  instanceId: string | null;
  catalogue: { revision: string; digest: string } | null;
  capabilities: ReadonlyMap<string, SidecarCapability>;
  error: SidecarClientError | null;
}

export interface SidecarMethodContract {
  validateParams: Validator;
  validateResult: Validator;
}

export interface DesktopSidecarClientOptions {
  transport: SidecarTransport;
  clientInfo: SidecarClientInfo;
  supportedProtocolVersions?: readonly string[];
  methodContracts?: Readonly<Record<string, SidecarMethodContract>>;
  discoveryTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
}

export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Observe the sidecar's on-device step log while this request runs, by
   * polling `sidecar.progress.v1` with the request's own ID. Polling is best
   * effort: it starts only when the sidecar advertises the capability, a
   * failed poll never affects the invoked request, and one final poll runs
   * after the request settles so the terminal state is observed.
   */
  progress?: InvokeProgressOptions;
}

export interface InvokeProgressOptions {
  onProgress: (progress: SidecarProgressV1Result) => void;
  /** Delay between polls. Defaults to 1000 ms; the minimum is 50 ms. */
  intervalMs?: number;
}

interface RequestOptions extends InvokeOptions {
  cancelOnAbort?: boolean;
  id?: string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const builtInContracts: Readonly<Record<string, SidecarMethodContract>> = {
  "diagnostics.echo.v1": {
    validateParams: validateDiagnosticsEchoV1Params,
    validateResult: validateDiagnosticsEchoV1Result,
  },
  "outlook.list_mailboxes.v1": {
    validateParams: validateOutlookListMailboxesV1Params,
    validateResult: validateOutlookListMailboxesV1Result,
  },
  "outlook.list_emails.v1": {
    validateParams: validateOutlookListEmailsV1Params,
    validateResult: validateOutlookListEmailsV1Result,
  },
  "outlook.get_conversation.v1": {
    validateParams: validateOutlookGetConversationV1Params,
    validateResult: validateOutlookGetConversationV1Result,
  },
  "sidecar.progress.v1": {
    validateParams: validateSidecarProgressV1Params,
    validateResult: validateSidecarProgressV1Result,
  },
  "sidecar.restart.v1": {
    validateParams: validateSidecarRestartV1Params,
    validateResult: validateSidecarRestartV1Result,
  },
  "sidecar.configure.v1": {
    validateParams: validateSidecarConfigureV1Params,
    validateResult: validateSidecarConfigureV1Result,
  },
};

const EMPTY_CAPABILITIES = new Map<string, SidecarCapability>();

export class DesktopSidecarClient {
  readonly #transport: SidecarTransport;
  readonly #clientInfo: SidecarClientInfo;
  readonly #supportedProtocolVersions: readonly string[];
  readonly #contracts: Readonly<Record<string, SidecarMethodContract>>;
  readonly #discoveryTimeoutMs: number;
  readonly #requestTimeoutMs: number;
  readonly #maxBodyBytes: number;
  readonly #maxResponseBytes: number;
  readonly #listeners = new Set<() => void>();
  #snapshot: SidecarSnapshot = emptySnapshot();
  #discovery: Promise<void> | undefined;
  #progressUnsupported = false;

  constructor(options: DesktopSidecarClientOptions) {
    if (options.supportedProtocolVersions?.length === 0) {
      throw new Error("At least one supported protocol version is required.");
    }
    this.#transport = options.transport;
    this.#clientInfo = options.clientInfo;
    this.#supportedProtocolVersions =
      options.supportedProtocolVersions ?? PROTOCOL_VERSIONS;
    if (
      new Set(this.#supportedProtocolVersions).size !==
      this.#supportedProtocolVersions.length
    ) {
      throw new Error("Supported protocol versions must be unique.");
    }
    this.#contracts = { ...builtInContracts, ...options.methodContracts };
    this.#discoveryTimeoutMs = options.discoveryTimeoutMs ?? 5_000;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  getSnapshot = (): SidecarSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  discover(signal?: AbortSignal): Promise<void> {
    this.#discovery ??= this.#runDiscovery(signal).finally(() => {
      this.#discovery = undefined;
    });
    return this.#discovery;
  }

  reset(): void {
    this.#discovery = undefined;
    this.#setSnapshot(emptySnapshot());
  }

  supports(method: string, major?: number): boolean {
    const versionedMethod =
      major === undefined ? method : `${method}.v${major}`;
    return (
      this.#snapshot.state === "ready" &&
      this.#contracts[versionedMethod] !== undefined &&
      this.#snapshot.capabilities.get(versionedMethod)?.availability ===
        "enabled"
    );
  }

  async invoke(
    method: "diagnostics.echo.v1",
    params: DiagnosticsEchoV1Params,
    options?: InvokeOptions,
  ): Promise<DiagnosticsEchoV1Result>;
  async invoke(
    method: "outlook.list_mailboxes.v1",
    params: OutlookListMailboxesV1Params,
    options?: InvokeOptions,
  ): Promise<OutlookListMailboxesV1Result>;
  async invoke(
    method: "outlook.list_emails.v1",
    params: OutlookListEmailsV1Params,
    options?: InvokeOptions,
  ): Promise<OutlookListEmailsV1Result>;
  async invoke(
    method: "outlook.get_conversation.v1",
    params: OutlookGetConversationV1Params,
    options?: InvokeOptions,
  ): Promise<OutlookGetConversationV1Result>;
  async invoke(
    method: "sidecar.progress.v1",
    params: SidecarProgressV1Params,
    options?: InvokeOptions,
  ): Promise<SidecarProgressV1Result>;
  async invoke(
    method: "sidecar.configure.v1",
    params: SidecarConfigureV1Params,
    options?: InvokeOptions,
  ): Promise<SidecarConfigureV1Result>;
  async invoke(
    method: "sidecar.restart.v1",
    params: SidecarRestartV1Params,
    options?: InvokeOptions,
  ): Promise<SidecarRestartV1Result>;
  async invoke(
    method: string,
    params: unknown,
    options: InvokeOptions = {},
  ): Promise<unknown> {
    const contract = this.#contracts[method];
    if (!contract || !this.supports(method)) {
      throw new SidecarClientError(
        "capability_unavailable",
        `Capability ${method} is not enabled by the current ready data.`,
      );
    }
    if (!contract.validateParams(params)) {
      throw this.#validationError(
        "invalid_params",
        `Parameters for ${method} do not match the pinned contract.`,
        contract.validateParams,
      );
    }

    const id = createRequestId();
    const stopProgressPolling =
      options.progress && method !== "sidecar.progress.v1"
        ? this.#startProgressPolling(id, options.progress)
        : undefined;

    let result: unknown;
    try {
      result = await this.#request(method, params, { ...options, id });
    } catch (error) {
      const clientError = this.#asClientError(error);
      if (clientError.kind === "capability_unavailable") {
        await this.discover().catch(() => undefined);
      } else if (
        clientError.kind === "malformed_message" ||
        clientError.kind === "invalid_result"
      ) {
        this.#failReadiness(clientError);
      }
      throw clientError;
    } finally {
      await stopProgressPolling?.();
    }

    if (!contract.validateResult(result)) {
      const error = this.#validationError(
        "invalid_result",
        `Result for ${method} does not match the pinned contract.`,
        contract.validateResult,
      );
      this.#failReadiness(error);
      throw error;
    }
    return result;
  }

  async #runDiscovery(signal?: AbortSignal): Promise<void> {
    this.#setSnapshot({
      state: "discovering",
      protocolVersion: null,
      serverInfo: null,
      instanceId: null,
      catalogue: null,
      capabilities: EMPTY_CAPABILITIES,
      error: null,
    });

    const params: DiscoverParams = {
      protocolVersions: [
        this.#supportedProtocolVersions[0],
        ...this.#supportedProtocolVersions.slice(1),
      ],
      clientInfo: {
        name: this.#clientInfo.name,
        version: this.#clientInfo.version,
      },
      host: this.#clientInfo.host,
      os: this.#clientInfo.os,
    };

    try {
      const rawResult = await this.#request("rpc.discover", params, {
        signal,
        timeoutMs: this.#discoveryTimeoutMs,
        cancelOnAbort: false,
      });
      if (!validateDiscoverResult(rawResult)) {
        throw this.#validationError(
          "invalid_result",
          "The sidecar returned an invalid discovery result.",
          validateDiscoverResult,
        );
      }
      const result = rawResult as DiscoverResult;
      if (!this.#supportedProtocolVersions.includes(result.protocolVersion)) {
        throw new SidecarClientError(
          "incompatible_protocol",
          `The sidecar selected unsupported protocol ${result.protocolVersion}.`,
        );
      }

      const catalogue = result.document["x-erato-catalogue"];
      const computedDigest = await catalogueDigest(result.document);
      if (catalogue.digest !== computedDigest) {
        throw new SidecarClientError(
          "invalid_result",
          "The discovery catalogue digest does not match its document.",
        );
      }
      const capabilities = this.#buildCapabilityRegistry(result.document);
      this.#progressUnsupported = false;
      this.#setSnapshot({
        state: "ready",
        protocolVersion: result.protocolVersion,
        serverInfo: result.serverInfo,
        instanceId: result.instanceId,
        catalogue,
        capabilities,
        error: null,
      });
    } catch (error) {
      const clientError = this.#asClientError(error);
      this.#failReadiness(clientError);
      throw clientError;
    }
  }

  #buildCapabilityRegistry(
    document: DiscoveryDocument,
  ): ReadonlyMap<string, SidecarCapability> {
    const capabilities = new Map<string, SidecarCapability>();
    for (const method of document.methods) {
      const descriptor = method["x-erato-capability"] as
        | CapabilityDescriptor
        | undefined;
      if (!descriptor) continue;
      if (
        descriptor.method !== method.name ||
        !descriptor.method.endsWith(`.v${descriptor.major}`) ||
        capabilities.has(method.name)
      ) {
        throw new SidecarClientError(
          "invalid_result",
          `Discovery contains an inconsistent or duplicate capability for ${method.name}.`,
        );
      }
      const state = descriptor.availability.state;
      const availability =
        state === "enabled"
          ? "enabled"
          : state === "disabled"
            ? "disabled"
            : "unknown";
      capabilities.set(method.name, {
        id: descriptor.id,
        major: descriptor.major,
        method: descriptor.method,
        availability,
        ...(typeof descriptor.availability.reasonCode === "string"
          ? { reasonCode: descriptor.availability.reasonCode }
          : {}),
      });
    }
    return capabilities;
  }

  async #request(
    method: string,
    params: unknown,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const id = options.id ?? createRequestId();
    const timeoutMs = options.timeoutMs ?? this.#requestTimeoutMs;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
      "x-erato-deadline-at": new Date(Date.now() + timeoutMs).toISOString(),
    };
    const body = JSON.stringify(request);
    this.#assertBodySize(body, this.#maxBodyBytes, "Request");

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort(options.signal?.reason);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("request timeout"));
    }, timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    try {
      const responseBody = await this.#transport.request(body, {
        signal: controller.signal,
      });
      this.#assertBodySize(responseBody, this.#maxResponseBytes, "Response");
      return this.#parseResponse(responseBody, id);
    } catch (error) {
      if (controller.signal.aborted) {
        const kind = timedOut ? "timeout" : "aborted";
        if (options.cancelOnAbort !== false && method !== "erato.cancel") {
          await this.#cancel(id, timedOut ? "timeout" : "user").catch(
            () => undefined,
          );
        }
        throw new SidecarClientError(
          kind,
          timedOut
            ? `Request ${method} timed out.`
            : `Request ${method} was aborted.`,
          { cause: error },
        );
      }
      throw this.#asClientError(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Poll `sidecar.progress.v1` for `requestId` until stopped. Returns an
   * async stop function that waits for the in-flight poll and then makes one
   * final observation, so the caller always sees the terminal state when the
   * sidecar still remembers the request.
   */
  #startProgressPolling(
    requestId: string,
    progress: InvokeProgressOptions,
  ): () => Promise<void> {
    const intervalMs = Math.max(progress.intervalMs ?? 1_000, 50);
    let active = true;
    let pending: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      pending = this.#pollProgress(requestId, progress.onProgress).finally(
        () => {
          if (active) timer = setTimeout(tick, intervalMs);
        },
      );
    };
    timer = setTimeout(tick, intervalMs);
    return async () => {
      active = false;
      clearTimeout(timer);
      await pending;
      await this.#pollProgress(requestId, progress.onProgress);
    };
  }

  /**
   * One best-effort progress poll. Never throws and never touches readiness:
   * observing a request must not affect the request being observed.
   */
  async #pollProgress(
    requestId: string,
    onProgress: (progress: SidecarProgressV1Result) => void,
  ): Promise<void> {
    if (this.#progressUnsupported || !this.supports("sidecar.progress.v1")) {
      return;
    }
    let result: unknown;
    try {
      result = await this.#request(
        "sidecar.progress.v1",
        { requestId } satisfies SidecarProgressV1Params,
        {
          timeoutMs: Math.min(this.#requestTimeoutMs, 2_000),
          cancelOnAbort: false,
        },
      );
    } catch (error) {
      // A sidecar that advertises the method but predates its implementation
      // answers -32601; remember that and stop asking for this session.
      if (error instanceof SidecarRpcError && error.code === -32601) {
        this.#progressUnsupported = true;
      }
      return;
    }
    if (validateSidecarProgressV1Result(result)) {
      try {
        onProgress(result as SidecarProgressV1Result);
      } catch {
        // A throwing observer callback must never reject the polling chain:
        // that would surface inside invoke's cleanup and replace the observed
        // request's real outcome with the observer's error.
      }
    }
  }

  async #cancel(requestId: string, reason: string): Promise<void> {
    const rawResult = await this.#request(
      "erato.cancel",
      { requestId, reason },
      {
        timeoutMs: Math.min(this.#requestTimeoutMs, 1_000),
        cancelOnAbort: false,
      },
    );
    if (!validateCancelResult(rawResult)) {
      throw this.#validationError(
        "invalid_result",
        "The sidecar returned an invalid cancellation result.",
        validateCancelResult,
      );
    }
  }

  #parseResponse(body: string, expectedId: string): unknown {
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch (cause) {
      throw new SidecarClientError(
        "malformed_message",
        "The sidecar returned invalid JSON.",
        { cause },
      );
    }
    if (!validateJsonRpcEnvelope(message)) {
      throw this.#validationError(
        "malformed_message",
        "The sidecar returned an invalid JSON-RPC response.",
        validateJsonRpcEnvelope,
      );
    }
    const record = message as Record<string, unknown>;
    if (typeof record.method === "string") {
      throw new SidecarClientError(
        "malformed_message",
        "The sidecar returned a request or notification instead of a response.",
      );
    }
    const response = message as JsonRpcResponse;
    if (response.id !== expectedId) {
      throw new SidecarClientError(
        "malformed_message",
        "The sidecar response ID does not match the HTTP request.",
      );
    }
    if (response.error) {
      throw new SidecarRpcError(
        response.error.code,
        response.error.message,
        response.error.data,
      );
    }
    return response.result;
  }

  #assertBodySize(body: string, limit: number, label: string): void {
    if (new TextEncoder().encode(body).byteLength > limit) {
      throw new SidecarClientError(
        "malformed_message",
        `${label} body exceeds ${limit} bytes.`,
      );
    }
  }

  #failReadiness(error: SidecarClientError): void {
    this.#setSnapshot({
      ...this.#snapshot,
      state: "error",
      capabilities: EMPTY_CAPABILITIES,
      error,
    });
  }

  #validationError(
    kind: "invalid_params" | "invalid_result" | "malformed_message",
    message: string,
    validator: Validator,
  ): SidecarClientError {
    const details = (validator.errors ?? [])
      .map(
        (error) =>
          `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
      )
      .join("; ");
    return new SidecarClientError(
      kind,
      details ? `${message} ${details}` : message,
    );
  }

  #asClientError(error: unknown): SidecarClientError {
    return error instanceof SidecarClientError
      ? error
      : new SidecarClientError(
          "transport_error",
          "Sidecar communication failed.",
          { cause: error },
        );
  }

  #setSnapshot(snapshot: SidecarSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

function emptySnapshot(): SidecarSnapshot {
  return {
    state: "unavailable",
    protocolVersion: null,
    serverInfo: null,
    instanceId: null,
    catalogue: null,
    capabilities: EMPTY_CAPABILITIES,
    error: null,
  };
}

function createRequestId(): string {
  return `c-${globalThis.crypto.randomUUID()}`;
}

async function catalogueDigest(document: DiscoveryDocument): Promise<string> {
  const digestInput = structuredClone(document);
  delete (digestInput["x-erato-catalogue"] as { digest?: string }).digest;
  const bytes = new TextEncoder().encode(canonicalJson(digestInput));
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
  return `sha256:${[...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
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

export function createBrowserClientInfo(options: {
  name: string;
  version: string;
  hostApplication?: string;
}): SidecarClientInfo {
  const navigatorValue = globalThis.navigator;
  const userAgent = navigatorValue?.userAgent ?? "unknown";
  const runtime = userAgent.includes("Edg/")
    ? "Edge"
    : userAgent.includes("Chrome/")
      ? "Chromium"
      : userAgent.includes("Safari/")
        ? "WebKit"
        : "browser";
  const osName = userAgent.includes("Windows")
    ? "Windows"
    : userAgent.includes("Mac OS")
      ? "macOS"
      : userAgent.includes("Linux")
        ? "Linux"
        : "unknown";
  return {
    name: options.name,
    version: options.version,
    host: {
      application: options.hostApplication ?? "browser",
      runtime,
    },
    os: { name: osName },
  };
}
