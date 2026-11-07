import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  MAX_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  SIDECAR_PROVIDER,
  UI_PACKAGE_CHUNK_BYTES,
  type CapabilityDescriptor,
  type DiscoverParams,
  type DiscoverResult,
  type IndexingStatusV1Result,
  type IndexingStatusV1Params,
  type CallToolResult,
  type JobCallResult,
  type JobStatus,
  type JobToolCall,
  type JobsStartV1Params,
  type SearchQueryV1Params,
  type ToolProviderTable,
  type SidecarConfigureV1Params,
  type SidecarInstallUiPackageV1Params,
  type SidecarInstallUiPackageV1Result,
  type SidecarUiPackageStatus,
  type DiscoveryDocument,
} from "../../typescript/src/index.js";
import {
  validateCancelParams,
  validateIndexingStartV1Params,
  validateIndexingStopV1Params,
  validateSourcesGetDocumentV1Params,
  validateSearchQueryV1Params,
  validateSearchMetadataFieldsV1Params,
  validateSearchMetadataFieldsV1Result,
  validateIndexingResetV1Params,
  validateIndexingStatusV1Params,
  validateJobsAckV1Params,
  validateJobsCancelV1Params,
  validateJobsReadV1Params,
  validateJobsReviewV1Params,
  validateJobsStartV1Params,
  validateJobsStatusV1Params,
  validateDiagnosticsEchoV1Params,
  validateDiscoverParams,
  validateOutlookGetConversationV1Params,
  validateOutlookListEmailsV1Params,
  validateOutlookListMailboxesV1Params,
  validateOutlookSearchEmailsV1Params,
  validateSidecarConfigureV1Params,
  validateSidecarInstallUiPackageV1Params,
  validateSidecarProgressV1Params,
  validateSidecarStatusV1Params,
  validateSidecarRequestPermissionV1Params,
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
  searchDelayMs?: number;
  /**
   * Method names this mock pretends not to know: they are removed from the
   * advertised catalogue and answered with -32601, simulating a previously
   * released sidecar for additive-rollout tests.
   */
  omitMethods?: readonly string[];
  /**
   * The installation id discovery reports; `null` omits it, as a sidecar
   * built before package 0.1.43 does.
   */
  installationId?: string | null;
  /**
   * Strict mode as discovery reports it (default false); `null` omits it, as
   * a sidecar built before package 0.1.44 does. Under strict, a job with a
   * content tool waits in `ready_for_review` for `decideReview`.
   */
  strict?: boolean | null;
  /**
   * The desktop UI discovery reports (default: host API 1, a seed and no
   * installed package); `null` omits it, as a sidecar built before package
   * 0.1.46 or one hosting no desktop UI does.
   */
  ui?: DiscoverResult["ui"] | null;
  /**
   * How the sidecar's own download of an offered desktop UI package ends
   * (default `"current"`: installed); `{ failed: reason }` reports that
   * failure, relayable for `network`, `proxy` and `tls`. `null` omits
   * `ui_package` from `sidecar.status.v1`, as a sidecar built before package
   * 0.1.47 does.
   */
  uiPackageDownload?: "current" | "pending" | { failed: string } | null;
  /** Whether a fully relayed archive verifies (default: every archive does). */
  acceptRelayedArchive?: (bytes: Uint8Array) => boolean;
  /** How long a job runs before it completes, to exercise `wait_ms`. */
  jobDelayMs?: number;
  /** Size of the mock document in bytes (default: a short text). */
  documentBytes?: number;
  /**
   * The response cap a job's serialized results stay within (default
   * `MAX_RESPONSE_BYTES`); match the client's `maxResponseBytes`.
   */
  maxResponseBytes?: number;
  /** The warnings the mock conversation reports (default none). */
  conversationWarnings?: readonly Record<string, unknown>[];
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

interface MockProgressEntry {
  state: "running" | "finished";
  steps: Array<Record<string, unknown>>;
  totalDurationMs?: number;
}

interface MockJob {
  origin: string;
  calls: readonly JobToolCall[];
  state: JobStatus["state"];
  results?: JobCallResult[];
  /** The frozen results a strict review decides on; never sent. */
  snapshot?: JobCallResult[];
  controller: AbortController;
  /** Long-polls to answer when the job changes state. */
  waiters: Set<() => void>;
}

interface MockUiPackageOffer {
  origin: string;
  digest: string;
  attemptedAt: string;
}

interface MockUiPackageUpload {
  uploadId: string;
  digest: string;
  totalBytes: number;
  chunkCount: number;
  chunks: Buffer[];
}

type MethodOutcome =
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string; data?: unknown } };
type ToolSelection = ToolProviderTable["tools"][number]["selection"];

const MAX_PROGRESS_ENTRIES = 256;
const MAX_JOB_CALLS = 8;
const MAX_JOB_WAIT_MS = 30_000;
/** Room a job response needs beside its results: the envelope and errors. */
const JOB_RESPONSE_RESERVE_BYTES = 16_384;
const PENDING_JOB_STATES = new Set<JobStatus["state"]>([
  "queued",
  "running",
  "awaiting_approval",
  "ready_for_review",
]);
const TERMINAL_JOB_STATES = new Set<JobStatus["state"]>([
  "acked",
  "declined",
  "cancelled",
  "expired",
  "failed",
]);

const RELAY_REASONS = new Set(["network", "proxy", "tls"]);
const INSTANCE_ID = "mock-sidecar-instance";
const INSTALLATION_ID = "mock-sidecar-installation-id-0123456789";
const MOCK_UI: NonNullable<DiscoverResult["ui"]> = {
  host_apis: [1],
  seed: { version: "0.1.0" },
  installed: null,
};
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
const MOCK_OUTLOOK_ATTACHMENT_BYTES = Buffer.from(
  "mock attachment bytes",
  "utf8",
);
const MOCK_OUTLOOK_EXTERNAL_IDS = [
  { key: "email_message_id", value: "<mock-outlook-email@example.com>" },
  { key: "ews_id", value: "AQMk/CaseSensitive+MockEwsId==" },
];
const MOCK_OUTLOOK_CONVERSATION_MESSAGE = {
  external_ids: MOCK_OUTLOOK_EXTERNAL_IDS,
  internetMessageId: "<mock-outlook-email@example.com>",
  subject: "Mock Outlook message",
  from: { name: "Erato Test", emailAddress: "test@example.com" },
  to: [{ name: "Mock Outlook mailbox", emailAddress: "mock@example.com" }],
  cc: [],
  sentAtUnixSeconds: 1_774_291_200,
  isDraft: false,
  body: {
    contentType: "text/plain",
    content: "Mock Outlook message body.",
  },
  attachments: [
    {
      name: "mock-attachment.pdf",
      external_ids: [],
      topLevelParent: { external_ids: MOCK_OUTLOOK_EXTERNAL_IDS },
      contentType: "application/pdf",
      size: MOCK_OUTLOOK_ATTACHMENT_BYTES.byteLength,
      isInline: false,
      sha256: createHash("sha256")
        .update(MOCK_OUTLOOK_ATTACHMENT_BYTES)
        .digest("hex"),
      contentBytes: MOCK_OUTLOOK_ATTACHMENT_BYTES.toString("base64"),
    },
  ],
};
/** The mock mailbox's catalog source, as `sources.list.v1` reports it. */
const MOCK_SOURCE = {
  sourceId: "5c1e8f0a-2b3d-4e6f-8a9b-0c1d2e3f4a5b",
  sourceKind: "mock",
  sourceKey: "mock-store",
  locator: { mailboxId: MOCK_OUTLOOK_MAILBOX.id },
  enabled: true,
  discoveryCursor: null,
  completedScanId: null,
  lastSuccessAt: null,
  lastErrorCode: null,
  capabilities: { folders: true, metadataFields: [] as string[] },
};
const MOCK_FOLDER = {
  nodeId: "mock-inbox",
  parentNodeId: null,
  name: "Inbox",
  pathName: "Inbox",
  artificialRoot: false,
  directLeafChildren: 1,
  totalLeafChildren: 1,
  directChildNodes: 0,
};
/** The fixed message a method error crosses a strict export with. */
const FIXED_ERROR_MESSAGES: Record<number, string> = {
  [-32011]: "The requested capability is unavailable.",
  [-32602]: "Invalid method parameters.",
};
/** The fixed message an item metadata entry crosses a strict export with. */
const FIXED_WARNING_MESSAGES: Record<string, string> = {
  truncated: "The conversation was truncated.",
  attachment_unavailable: "An attachment could not be read.",
  embedded_attachments_omitted: "Embedded attachments were omitted.",
  body_preview_only:
    "Only the body preview the application cached is available.",
  body_unavailable: "The message body could not be read.",
  body_truncated: "The message body was truncated.",
  unsupported_source:
    "The mailbox cannot be read as conversations; retrying cannot help.",
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

const mockIndexingStatistics = JSON.parse(
  readFileSync(
    new URL("./conformance/fixtures/indexing-statistics.json", openRpcUrl),
    "utf8",
  ),
) as IndexingStatusV1Result;

export class MockSidecar {
  readonly #options: Required<
    Pick<
      MockSidecarOptions,
      | "host"
      | "port"
      | "path"
      | "supportedProtocolVersions"
      | "echoDelayMs"
      | "searchDelayMs"
    >
  > &
    MockSidecarOptions;
  readonly #allowedOrigins: Set<string>;
  readonly #inFlight = new Map<string, AbortController>();
  readonly #progress = new Map<string, MockProgressEntry>();
  readonly #jobs = new Map<string, MockJob>();
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
  #configuration: SidecarConfigureV1Params | undefined;
  #restartRequests = 0;
  #indexingStopped = false;
  #indexingResetCompletedAt: string | undefined;
  #uiPackageOffer: MockUiPackageOffer | undefined;
  #uiPackageDownload: "current" | "pending" | { failed: string } = "current";
  #installedUiPackage: string | undefined;
  #uiPackageUpload: MockUiPackageUpload | undefined;
  #relayedArchive: Uint8Array | undefined;

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
      searchDelayMs: options.searchDelayMs ?? 0,
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

  get configuration(): unknown {
    return this.#configuration;
  }

  /** The last archive a client relayed completely, verified or not. */
  get relayedArchive(): Uint8Array | undefined {
    return this.#relayedArchive;
  }

  /**
   * Stand in for the native review window, which no RPC can drive: approve
   * the given item positions of each call that has a selection, or decline
   * with `null`.
   */
  decideReview(
    handle: string,
    approved: readonly (readonly number[])[] | null,
  ): void {
    const job = this.#jobs.get(handle);
    if (job?.state !== "ready_for_review" || !job.snapshot)
      throw new Error("The job is not ready for review.");
    const snapshot = job.snapshot;
    delete job.snapshot;
    if (approved === null) {
      settleJob(job, "declined");
      return;
    }
    job.results = withinResponseBudget(
      snapshot.map((entry, index) =>
        exportApproved(
          entry,
          sidecarTool(job.calls[index])?.selection ?? null,
          approved[index] ?? [],
        ),
      ),
      this.#jobResponseBudget(),
    );
    settleJob(job, "approved");
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
    this.#progress.clear();
    for (const job of this.#jobs.values()) job.controller.abort();
    this.#jobs.clear();
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
    if (this.#options.omitMethods?.includes(message.method)) {
      return rpcError(message.id, -32601, "Method not found.");
    }
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
      const installationId =
        this.#options.installationId === undefined
          ? INSTALLATION_ID
          : this.#options.installationId;
      const strict = this.#options.strict ?? false;
      const ui = this.#options.ui === undefined ? MOCK_UI : this.#options.ui;
      return rpcResult(message.id, {
        protocolVersion,
        serverInfo: { name: "erato-mock-sidecar", version: "0.1.0" },
        instanceId: INSTANCE_ID,
        ...(installationId === null ? {} : { installationId }),
        document: this.#discoveryDocument(),
        ...(this.#options.strict === null ? {} : { strict }),
        ...(ui === null ? {} : { ui }),
        ...(this.#options.omitMethods?.includes("jobs.start.v1")
          ? {}
          : {
              jobs: { maxCalls: MAX_JOB_CALLS, maxWaitMs: MAX_JOB_WAIT_MS },
              providers: [
                {
                  id: SIDECAR_PROVIDER.id,
                  tools: SIDECAR_PROVIDER.tools.map((tool) => tool.name),
                  readOnly: SIDECAR_PROVIDER.readOnly,
                  egress: SIDECAR_PROVIDER.egress,
                  available: true,
                },
              ],
            }),
      });
    }

    if (message.method.startsWith("jobs.")) {
      return this.#handleJobRequest(origin, message);
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

    if (message.method === "sidecar.progress.v1") {
      if (!validateSidecarProgressV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      const requestId = (message.params as { requestId: string | number })
        .requestId;
      const entry = this.#progress.get(requestKey(origin, requestId));
      if (!entry) {
        return rpcResult(message.id, { state: "unknown" });
      }
      return rpcResult(message.id, {
        state: entry.state,
        trace: {
          steps: entry.steps.map((step) => ({ ...step })),
          ...(entry.totalDurationMs === undefined
            ? {}
            : { totalDurationMs: entry.totalDurationMs }),
        },
      });
    }

    if (message.method === "sidecar.status.v1") {
      if (!validateSidecarStatusV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      return rpcResult(message.id, {
        permissions: { macos_full_disk_access: "unknown" },
        ...(this.#hostsDesktopUi() && this.#options.uiPackageDownload !== null
          ? { ui_package: this.#uiPackageStatus(origin) }
          : {}),
      });
    }
    if (message.method === "sidecar.install_ui_package.v1") {
      return this.#installUiPackage(origin, message);
    }
    if (message.method === "sidecar.request_permission.v1") {
      if (
        !validateSidecarRequestPermissionV1Params(message.params) ||
        (message.params as { permission: string }).permission !==
          "macos_full_disk_access"
      )
        return rpcError(message.id, -32602, "Unsupported permission.");
      return rpcResult(message.id, { opened: true });
    }
    if (message.method === "sidecar.restart.v1") {
      if (!validateSidecarRestartV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      this.#restartRequests += 1;
      return rpcResult(message.id, { accepted: true });
    }

    if (message.method === "sources.get_document.v1") {
      if (!validateSourcesGetDocumentV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      return rpcResult(message.id, {
        filename: "document.txt",
        external_ids: [],
        mimeType: "text/plain",
        contentBase64: this.#mockDocumentBase64(),
      });
    }
    if (message.method === "search.query.v1") {
      if (!validateSearchQueryV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      if (this.#indexingResetCompletedAt)
        return rpcError(message.id, -32011, "Index not initialized.", {
          kind: "capability_unavailable",
          reason: "index_not_initialized",
        });
      return rpcResult(message.id, {
        hits: [],
        elapsedMs: 0,
        blocksRead: 0,
        candidatesScored: 0,
      });
    }
    if (message.method === "search.metadata_fields.v1") {
      if (!validateSearchMetadataFieldsV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      const result = { fields: [] };
      if (!validateSearchMetadataFieldsV1Result(result))
        return rpcError(
          message.id,
          -32016,
          "The sidecar could not complete the request.",
        );
      return rpcResult(message.id, result);
    }
    if (
      message.method === "indexing.start.v1" ||
      message.method === "indexing.stop.v1"
    ) {
      const start = message.method === "indexing.start.v1";
      const validate = start
        ? validateIndexingStartV1Params
        : validateIndexingStopV1Params;
      if (!validate(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      this.#indexingStopped = !start;
      if (start) this.#indexingResetCompletedAt = undefined;
    }
    if (message.method === "indexing.reset.v1") {
      if (!validateIndexingResetV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      this.#indexingResetCompletedAt ??= new Date().toISOString();
      return rpcResult(message.id, {
        completed: true,
        completedAt: this.#indexingResetCompletedAt,
        state: "stopped",
      });
    }

    if (
      ["indexing.status.v1", "indexing.start.v1", "indexing.stop.v1"].includes(
        message.method,
      )
    ) {
      if (!validateIndexingStatusV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      const params = message.params as IndexingStatusV1Params;
      const result = structuredClone(mockIndexingStatistics);
      result.configuration = structuredClone(
        this.#configuration ?? {
          user_configuration: {},
          organization_configuration: {},
        },
      );
      if (this.#indexingStopped) result.state = "stopped";
      const user = this.#configuration?.user_configuration;
      const organization = this.#configuration?.organization_configuration;
      result.effectiveConfiguration = {
        parallelism:
          user?.indexing_parallelism ?? organization?.indexing_parallelism ?? 1,
        documentsPerMinute:
          user?.indexing_documents_per_minute ??
          organization?.indexing_documents_per_minute ??
          40,
      };
      if (this.#indexingResetCompletedAt) {
        const sampledAt = new Date().toISOString();
        result.sampledAt = sampledAt;
        result.state = "stopped";
        result.resetInProgress = false;
        result.generations = [];
        result.discovery = [];
        result.resources.sampledAt = sampledAt;
        result.resources.disk.sampledAt = sampledAt;
        result.resources.disk.allocatedBytes = 0;
        result.resources.disk.logicalBytes = 0;
        for (const key of [
          "control",
          "catalog",
          "activeIndex",
          "buildingIndex",
          "retiredIndexes",
          "wal",
          "temporary",
        ] as const) {
          result.resources.disk.breakdown[key] = {
            allocatedBytes: 0,
            logicalBytes: 0,
          };
        }
        result.resources.liveExtractionWorkers = [];
        result.resources.extractionWorkers = {
          ...result.resources.extractionWorkers,
          processCount: 0,
          cpuCoresUsed: 0,
          memoryResidentBytes: 0,
          diskReadBytesPerSecond: 0,
          diskWriteBytesPerSecond: 0,
        };
      }
      for (const generation of result.generations) {
        generation.segments = generation.segments.filter(
          (segment) =>
            (params.includeSourceBreakdowns !== false ||
              (segment.sourceId === null && segment.mailboxId === null)) &&
            (params.includeFileTypeBreakdowns !== false ||
              segment.fileType === null),
        );
      }
      return rpcResult(message.id, result);
    }

    if (message.method === "sidecar.configure.v1") {
      if (!validateSidecarConfigureV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      const configuration = message.params as SidecarConfigureV1Params;
      for (const layer of [
        configuration.user_configuration,
        configuration.organization_configuration,
      ]) {
        const ids =
          layer.indexing_mailboxes?.map((mailbox) =>
            mailbox.mailbox_id.toLowerCase(),
          ) ?? [];
        if (new Set(ids).size !== ids.length)
          return rpcError(message.id, -32602, "Duplicate mailbox IDs.");
      }
      this.#configuration = structuredClone(
        message.params,
      ) as SidecarConfigureV1Params;
      if (configuration.ui_package && this.#hostsDesktopUi())
        this.#offerUiPackage(origin, configuration.ui_package.digest);
      return rpcResult(message.id, {});
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

    if (message.method === "outlook.search_emails.v1") {
      if (!validateOutlookSearchEmailsV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      if (
        (message.params as { mailboxId: string }).mailboxId !==
        MOCK_OUTLOOK_MAILBOX.id
      ) {
        return rpcError(message.id, -32602, "Unknown Outlook mailbox.");
      }
      const key = requestKey(origin, message.id);
      if (this.#inFlight.has(key)) {
        return rpcError(message.id, -32600, "Duplicate pending request ID.");
      }
      const controller = new AbortController();
      this.#inFlight.set(key, controller);
      const halfDelayMs = this.#options.searchDelayMs / 2;
      const startedAt = Date.now();
      const progress: MockProgressEntry = {
        state: "running",
        steps: [
          {
            sequence: 0,
            id: "buildIndex",
            status: "ok",
            cacheHit: false,
            counts: { messagesScanned: 42 },
          },
          {
            sequence: 1,
            id: "expandQuery",
            status: "running",
            model: "mock-local-model",
          },
        ],
      };
      this.#recordProgress(key, progress);
      const answerCancelled = (): unknown => {
        progress.steps = progress.steps.map((step) =>
          step.status === "running"
            ? { ...step, status: "skipped", detail: "cancelled" }
            : step,
        );
        return rpcError(message.id, -32014, "The request was cancelled.", {
          kind: "request_cancelled",
          requestId: message.id,
        });
      };
      try {
        if (halfDelayMs > 0) {
          await abortableDelay(halfDelayMs, controller.signal);
        }
        if (controller.signal.aborted) return answerCancelled();
        progress.steps = [
          ...progress.steps.slice(0, -1),
          {
            sequence: 1,
            id: "expandQuery",
            status: "ok",
            model: "mock-local-model",
            counts: { keywordsIn: 2, keywordsOut: 5 },
          },
          {
            sequence: 2,
            id: "match",
            status: "ok",
            counts: { matched: 3, hitsReturned: 1 },
          },
          {
            sequence: 3,
            id: "summarize",
            status: "running",
            model: "mock-local-model",
          },
        ];
        if (halfDelayMs > 0) {
          await abortableDelay(halfDelayMs, controller.signal);
        }
        if (controller.signal.aborted) return answerCancelled();
        progress.steps = progress.steps.map((step) =>
          step.status === "running" ? { ...step, status: "ok" } : step,
        );
        progress.totalDurationMs = Date.now() - startedAt;
        const query = (message.params as { query: string }).query.toLowerCase();
        const matches = (MOCK_OUTLOOK_EMAIL.subject ?? "")
          .toLowerCase()
          .includes(query);
        return rpcResult(message.id, {
          mailbox: MOCK_OUTLOOK_MAILBOX,
          hits: matches
            ? [
                {
                  email: MOCK_OUTLOOK_EMAIL,
                  snippet: "Mock Outlook message body.",
                  matchedIn: ["subject"],
                },
              ]
            : [],
          totalMatched: matches ? 1 : 0,
          trace: {
            steps: progress.steps.map((step) => ({ ...step })),
            totalDurationMs: progress.totalDurationMs,
          },
          summary: matches
            ? "One mock Outlook message matched the query."
            : undefined,
          summaryModel: matches ? "mock-local-model" : undefined,
          warnings: [],
        });
      } finally {
        progress.state = "finished";
        progress.totalDurationMs ??= Date.now() - startedAt;
        this.#inFlight.delete(key);
      }
    }

    if (message.method === "outlook.get_conversation.v1") {
      if (!validateOutlookGetConversationV1Params(message.params)) {
        return rpcError(message.id, -32602, "Invalid method parameters.");
      }
      if (
        (message.params as { mailboxId: string }).mailboxId !==
        MOCK_OUTLOOK_MAILBOX.id
      ) {
        return rpcError(message.id, -32602, "Unknown Outlook mailbox.");
      }
      return rpcResult(message.id, {
        state: "ok",
        mailbox: MOCK_OUTLOOK_MAILBOX,
        messages: [MOCK_OUTLOOK_CONVERSATION_MESSAGE],
        warnings: [...(this.#options.conversationWarnings ?? [])],
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
    const delayMs =
      (message.params as { delayMs?: number }).delayMs ??
      this.#options.echoDelayMs;
    const startedAt = Date.now();
    const progress: MockProgressEntry = {
      state: "running",
      steps: [
        { sequence: 0, id: "delay", status: "running", startedAtOffsetMs: 0 },
      ],
    };
    this.#recordProgress(key, progress);
    try {
      if (delayMs > 0) {
        await abortableDelay(delayMs, controller.signal);
      }
      const durationMs = Date.now() - startedAt;
      if (controller.signal.aborted) {
        progress.steps = [
          {
            sequence: 0,
            id: "delay",
            status: "skipped",
            startedAtOffsetMs: 0,
            durationMs,
            detail: "cancelled",
          },
        ];
        return rpcError(message.id, -32014, "The request was cancelled.", {
          kind: "request_cancelled",
          requestId: message.id,
        });
      }
      progress.steps = [
        {
          sequence: 0,
          id: "delay",
          status: "ok",
          startedAtOffsetMs: 0,
          durationMs,
        },
      ];
      return rpcResult(
        message.id,
        this.#options.echoResultOverride ?? {
          message: (message.params as { message: string }).message,
          sidecarInstanceId: INSTANCE_ID,
        },
      );
    } finally {
      progress.state = "finished";
      progress.totalDurationMs = Date.now() - startedAt;
      this.#inFlight.delete(key);
    }
  }

  async #handleJobRequest(
    origin: string,
    message: RequestMessage & { id: string | number },
  ): Promise<unknown> {
    if (message.method === "jobs.start.v1") {
      if (!validateJobsStartV1Params(message.params))
        return rpcError(message.id, -32602, "Invalid method parameters.");
      const params = message.params as JobsStartV1Params;
      if (params.calls.length > MAX_JOB_CALLS)
        return rpcError(message.id, -32602, "Too many calls for one job.");
      const handle = randomBytes(32).toString("base64url");
      const job: MockJob = {
        origin,
        calls: params.calls,
        state: "queued",
        controller: new AbortController(),
        waiters: new Set(),
      };
      this.#jobs.set(handle, job);
      void this.#runJob(job);
      await waitForJob(job, params.wait_ms, "running");
      return rpcResult(message.id, reportJob(handle, job));
    }

    const validators: Record<string, (value: unknown) => boolean> = {
      "jobs.status.v1": validateJobsStatusV1Params,
      "jobs.read.v1": validateJobsReadV1Params,
      "jobs.ack.v1": validateJobsAckV1Params,
      "jobs.cancel.v1": validateJobsCancelV1Params,
      "jobs.review.v1": validateJobsReviewV1Params,
    };
    const validate = validators[message.method];
    if (!validate) return rpcError(message.id, -32601, "Method not found.");
    if (!validate(message.params))
      return rpcError(message.id, -32602, "Invalid method parameters.");
    const { handle, wait_ms: waitMs } = message.params as {
      handle: string;
      wait_ms?: number;
    };
    // A handle never issued, issued to another Origin or forgotten reads as
    // expired, so a guessed handle learns nothing.
    const found = this.#jobs.get(handle);
    const job = found?.origin === origin ? found : undefined;

    if (message.method === "jobs.read.v1") {
      if (!job?.results)
        return rpcError(message.id, -32602, "The job has no results to read.");
      if (job.state === "completed" || job.state === "approved")
        job.state = "read";
      return rpcResult(message.id, { results: job.results });
    }
    if (!job) return rpcResult(message.id, { handle, state: "expired" });
    if (message.method === "jobs.ack.v1") {
      if (job.results) {
        job.state = "acked";
        delete job.results;
      }
    } else if (message.method === "jobs.cancel.v1") {
      if (!TERMINAL_JOB_STATES.has(job.state)) {
        delete job.results;
        delete job.snapshot;
        job.controller.abort();
        settleJob(job, "cancelled");
      }
    } else if (message.method === "jobs.status.v1") {
      await waitForJob(job, waitMs);
    } else {
      // jobs.review.v1 only reports the state, the mock having no window to
      // open: it never delivers results, so a finished job stays unread.
      return rpcResult(message.id, { handle, state: job.state });
    }
    return rpcResult(message.id, reportJob(handle, job));
  }

  /**
   * Run a job's calls as internal read-only operations, never through the RPC
   * dispatcher, so a job can reach only the provider table's tools. Under
   * strict, a job with a content tool freezes its results for review.
   */
  async #runJob(job: MockJob): Promise<void> {
    const signal = job.controller.signal;
    job.state = "running";
    if (this.#options.jobDelayMs) {
      await abortableDelay(this.#options.jobDelayMs, signal);
    }
    if (signal.aborted) return;
    const results = job.calls.map((call) => this.#runToolCall(call));
    if (
      this.#options.strict &&
      job.calls.some((call) => sidecarTool(call)?.selection)
    ) {
      job.snapshot = results;
      settleJob(job, "ready_for_review");
      return;
    }
    job.results = withinResponseBudget(results, this.#jobResponseBudget());
    settleJob(job, "completed");
  }

  #jobResponseBudget(): number {
    return (
      (this.#options.maxResponseBytes ?? MAX_RESPONSE_BYTES) -
      JOB_RESPONSE_RESERVE_BYTES
    );
  }

  #mockDocumentBase64(): string {
    const bytes =
      this.#options.documentBytes === undefined
        ? Buffer.from("Mock document")
        : Buffer.alloc(this.#options.documentBytes, "m");
    return bytes.toString("base64");
  }

  /**
   * A tool's raw composition: the outcome of each method it ran, as the
   * direct RPC answers, with file bytes moved into embedded resources.
   */
  #runToolCall(call: JobToolCall): JobCallResult {
    const tool = sidecarTool(call);
    if (!tool) {
      return callError(-32011, "The requested capability is unavailable.", {
        kind: "capability_unavailable",
      });
    }
    const args = call.arguments ?? {};
    const sources: MethodOutcome = { result: { sources: [MOCK_SOURCE] } };
    const mailboxes: MethodOutcome = {
      result: { mailboxes: [MOCK_OUTLOOK_MAILBOX], warnings: [] },
    };
    switch (call.name) {
      case "list_sidecar_mailboxes":
        if (Object.keys(args).length) return invalidArguments();
        return composed({
          "outlook.list_mailboxes.v1": mailboxes,
          "sources.list.v1": sources,
        });
      case "get_sidecar_search_fields":
        return composed({
          "search.metadata_fields.v1": { result: { fields: [] } },
          "sources.list.v1": sources,
        });
      case "get_sidecar_folder_hierarchy":
        if (typeof args.sourceId !== "string") return invalidArguments();
        // The mock reads the folders of its own source only; the source list
        // names any other source, whose folders are unsupported.
        return composed(
          args.sourceId === MOCK_SOURCE.sourceId
            ? {
                "sources.get_folder_hierarchy.v1": {
                  result: { sourceId: args.sourceId, nodes: [MOCK_FOLDER] },
                },
              }
            : {
                "sources.get_folder_hierarchy.v1": {
                  error: {
                    code: -32016,
                    message: "The sidecar could not complete the request.",
                    data: {
                      kind: "sidecar_internal",
                      sourceError: "unsupported_source",
                    },
                  },
                },
                "sources.list.v1": sources,
              },
        );
      case "search_sidecar_index": {
        if (!validateSearchQueryV1Params(args)) return invalidArguments();
        const filtered = Boolean(
          (args as SearchQueryV1Params).metadata_filters?.length,
        );
        return composed({
          "search.query.v1": {
            result: {
              hits: [],
              elapsedMs: 0,
              blocksRead: 0,
              candidatesScored: 0,
              coverage: {
                sampledAt: new Date().toISOString(),
                basis: "index",
                sources: [],
              },
              limitReached: false,
            },
          },
          "sources.list.v1": sources,
          ...(filtered
            ? { "search.metadata_fields.v1": { result: { fields: [] } } }
            : {}),
        });
      }
      case "read_sidecar_conversation": {
        if (
          typeof args.mailboxId !== "string" ||
          typeof args.internetMessageId !== "string"
        )
          return invalidArguments();
        if (args.mailboxId !== MOCK_OUTLOOK_MAILBOX.id)
          return composed({
            "outlook.get_conversation.v1": {
              error: { code: -32602, message: "Unknown Outlook mailbox." },
            },
          });
        const mailbox = {
          mailboxId: MOCK_OUTLOOK_MAILBOX.id,
          emailAddress: MOCK_OUTLOOK_MAILBOX.emailAddress,
        };
        const files: Record<string, unknown>[] = [];
        const messages = [MOCK_OUTLOOK_CONVERSATION_MESSAGE].map(
          (message, messageIndex) => ({
            ...message,
            attachments: message.attachments.map(
              ({ contentBytes, ...attachment }, attachmentIndex) => {
                files.push(
                  fileBlock(
                    `erato-sidecar:attachment/${attachment.sha256}`,
                    `/outlook.get_conversation.v1/result/messages/${messageIndex}/attachments/${attachmentIndex}`,
                    attachment.contentType,
                    contentBytes,
                    {
                      version: 1,
                      origins: [
                        {
                          topLevelParent: {
                            ...attachment.topLevelParent,
                            mailbox,
                          },
                        },
                      ],
                    },
                  ),
                );
                return attachment;
              },
            ),
          }),
        );
        return composed(
          {
            "outlook.get_conversation.v1": {
              result: {
                state: "ok",
                mailbox: MOCK_OUTLOOK_MAILBOX,
                messages,
                warnings: [...(this.#options.conversationWarnings ?? [])],
              },
            },
          },
          files,
        );
      }
      case "get_sidecar_document": {
        if (!validateSourcesGetDocumentV1Params(args))
          return invalidArguments();
        const { documentId } = args as { documentId: string };
        // A plain file with no message identity carries no provenance.
        return composed(
          {
            "sources.get_document.v1": {
              result: {
                filename: "document.txt",
                external_ids: [],
                mimeType: "text/plain",
              },
            },
            "outlook.list_mailboxes.v1": mailboxes,
          },
          [
            fileBlock(
              `erato-sidecar:document/${documentId}`,
              "/sources.get_document.v1/result",
              "text/plain",
              this.#mockDocumentBase64(),
            ),
          ],
        );
      }
      default:
        return callError(-32011, "The requested capability is unavailable.", {
          kind: "capability_unavailable",
        });
    }
  }

  /**
   * Remember a request's step log so `sidecar.progress.v1` can answer for it,
   * evicting the oldest finished entries beyond a small cap. Finished entries
   * stay observable, mirroring a real sidecar's short retention window.
   */
  #recordProgress(key: string, entry: MockProgressEntry): void {
    this.#progress.delete(key);
    this.#progress.set(key, entry);
    if (this.#progress.size <= MAX_PROGRESS_ENTRIES) return;
    for (const [staleKey, stale] of this.#progress) {
      if (this.#progress.size <= MAX_PROGRESS_ENTRIES) break;
      if (stale.state === "finished") this.#progress.delete(staleKey);
    }
  }

  #hostsDesktopUi(): boolean {
    return this.#options.ui !== null;
  }

  #offerUiPackage(origin: string, digest: string): void {
    if (this.#uiPackageOffer?.digest !== digest) {
      this.#uiPackageUpload = undefined;
      this.#uiPackageDownload = this.#options.uiPackageDownload ?? "current";
      if (this.#uiPackageDownload === "current")
        this.#installedUiPackage = digest;
    }
    this.#uiPackageOffer = {
      origin,
      digest,
      attemptedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    };
  }

  #uiPackageRelayable(origin: string): boolean {
    const offer = this.#uiPackageOffer;
    const download = this.#uiPackageDownload;
    return (
      offer !== undefined &&
      offer.origin === origin &&
      offer.digest !== this.#installedUiPackage &&
      this.#uiPackageUpload === undefined &&
      typeof download === "object" &&
      RELAY_REASONS.has(download.failed)
    );
  }

  #uiPackageStatus(origin: string): SidecarUiPackageStatus | null {
    const offer = this.#uiPackageOffer;
    if (!offer) return null;
    const report = {
      digest: offer.digest,
      attempted_at: offer.attemptedAt,
      relay: this.#uiPackageRelayable(origin),
    };
    if (offer.digest === this.#installedUiPackage)
      return { ...report, state: "current" };
    const download = this.#uiPackageDownload;
    return this.#uiPackageUpload || typeof download !== "object"
      ? { ...report, state: "pending" }
      : { ...report, state: "failed", reason: download.failed };
  }

  /** The relay session rules of SPEC.md §11 for one upload in memory. */
  #installUiPackage(
    origin: string,
    message: RequestMessage & { id: string | number },
  ): unknown {
    if (!this.#hostsDesktopUi())
      return rpcError(
        message.id,
        -32011,
        "The requested capability is unavailable.",
        {
          kind: "capability_unavailable",
          method: message.method,
          reasonCode: "desktop_ui_not_hosted",
        },
      );
    if (!validateSidecarInstallUiPackageV1Params(message.params))
      return rpcError(message.id, -32602, "Invalid method parameters.");
    const params = message.params as SidecarInstallUiPackageV1Params;
    const content = Buffer.from(params.content_base64, "base64");
    const lastIndex = params.chunk_count - 1;
    const upload = this.#uiPackageUpload;
    if (
      params.chunk_count !==
        Math.ceil(params.total_bytes / UI_PACKAGE_CHUNK_BYTES) ||
      params.chunk_index > lastIndex ||
      content.byteLength !==
        (params.chunk_index < lastIndex
          ? UI_PACKAGE_CHUNK_BYTES
          : params.total_bytes - UI_PACKAGE_CHUNK_BYTES * lastIndex) ||
      (upload?.uploadId === params.upload_id &&
        (upload.digest !== params.digest ||
          upload.totalBytes !== params.total_bytes ||
          upload.chunkCount !== params.chunk_count))
    )
      return rpcError(message.id, -32602, "Invalid method parameters.");

    const answer = (result: SidecarInstallUiPackageV1Result) =>
      rpcResult(message.id, result);
    if (params.digest === this.#installedUiPackage) {
      if (upload?.digest === params.digest) this.#uiPackageUpload = undefined;
      return answer({ state: "installed" });
    }
    if (upload?.uploadId === params.upload_id) {
      if (params.chunk_index === upload.chunks.length) {
        upload.chunks.push(content);
        if (upload.chunks.length === upload.chunkCount)
          return answer(this.#finishUiPackageUpload(upload));
      }
      return answer({
        state: "continue",
        next_chunk_index: upload.chunks.length,
      });
    }
    if (upload) return answer({ state: "busy" });
    const offer = this.#uiPackageOffer;
    if (offer?.origin !== origin || offer.digest !== params.digest)
      return answer({ state: "refused", reason: "not_offered" });
    if (this.#uiPackageDownload === "pending") return answer({ state: "busy" });
    if (!this.#uiPackageRelayable(origin))
      return answer({ state: "refused", reason: "not_eligible" });
    if (params.chunk_index !== 0)
      return answer({ state: "continue", next_chunk_index: 0 });
    const started: MockUiPackageUpload = {
      uploadId: params.upload_id,
      digest: params.digest,
      totalBytes: params.total_bytes,
      chunkCount: params.chunk_count,
      chunks: [content],
    };
    if (started.chunkCount === 1)
      return answer(this.#finishUiPackageUpload(started));
    this.#uiPackageUpload = started;
    return answer({ state: "continue", next_chunk_index: 1 });
  }

  #finishUiPackageUpload(
    upload: MockUiPackageUpload,
  ): SidecarInstallUiPackageV1Result {
    this.#uiPackageUpload = undefined;
    const bytes = new Uint8Array(Buffer.concat(upload.chunks));
    this.#relayedArchive = bytes;
    if (this.#options.acceptRelayedArchive?.(bytes) === false) {
      this.#uiPackageDownload = { failed: "verification" };
      return { state: "refused", reason: "verification" };
    }
    this.#installedUiPackage = upload.digest;
    return { state: "installed" };
  }

  #discoveryDocument(): DiscoveryDocument {
    const document = structuredClone(canonicalOpenRpc);
    if (this.#options.omitMethods?.length) {
      document.methods = document.methods.filter(
        (method) => !this.#options.omitMethods?.includes(method.name),
      );
    }
    const relayMethod = document.methods.find(
      (method) => method.name === "sidecar.install_ui_package.v1",
    );
    if (relayMethod?.["x-erato-capability"] && !this.#hostsDesktopUi()) {
      (relayMethod["x-erato-capability"] as CapabilityDescriptor).availability =
        { state: "disabled", reasonCode: "desktop_ui_not_hosted" };
    }
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
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin === "null" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Origin must be an exact http or https origin: ${value}`);
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

/** A `sidecar` tool's result: the methods' outcomes and the files they returned. */
function composed(
  outcomes: Record<string, MethodOutcome>,
  files: Record<string, unknown>[] = [],
): JobCallResult {
  return {
    result: {
      content: files as CallToolResult["content"],
      structuredContent: outcomes,
    },
  };
}

/** A file as an embedded resource, naming the object its bytes came from. */
function fileBlock(
  uri: string,
  item: string,
  mimeType: string,
  blob: string,
  provenance?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "resource",
    resource: { uri, mimeType, blob },
    _meta: {
      "ai.erato/item": item,
      ...(provenance ? { "ai.erato/outlookProvenance": provenance } : {}),
    },
  };
}

function invalidArguments(): JobCallResult {
  return callError(-32602, "Invalid method parameters.");
}

function sidecarTool(call: JobToolCall | undefined) {
  return call?.server === SIDECAR_PROVIDER.id
    ? SIDECAR_PROVIDER.tools.find((entry) => entry.name === call.name)
    : undefined;
}

/**
 * A strict export of one call: the frozen result filtered to the approved
 * items, with its result-level metadata, the item metadata entries of the
 * whole result or an approved item, and its method errors, both under a fixed
 * message. Item pointers in the export refer to the filtered result.
 */
function exportApproved(
  entry: JobCallResult,
  selection: ToolSelection,
  approved: readonly number[],
): JobCallResult {
  const { result } = entry as { result?: CallToolResult };
  if (!result || !selection) return entry;
  const source = result.structuredContent ?? {};
  const exported: Record<string, unknown> = {};
  for (const [method, outcome] of Object.entries(source)) {
    const error = (outcome as { error?: { code: number; data?: unknown } })
      .error;
    if (error)
      exported[method] = {
        error: {
          code: error.code,
          message:
            FIXED_ERROR_MESSAGES[error.code] ??
            "The sidecar could not complete the request.",
          ...(error.data === undefined ? {} : { data: error.data }),
        },
      };
  }
  for (const pointer of selection.resultMetadata)
    copyPointer(source, exported, pointer);
  const itemOf = (block: CallToolResult["content"][number]) => {
    const item = block._meta?.["ai.erato/item"];
    return typeof item === "string" ? item : undefined;
  };
  let content: CallToolResult["content"];
  let approvedItems: unknown[];
  if (selection.items === "content") {
    content = result.content.filter((_, index) => approved.includes(index));
    approvedItems = [];
    for (const block of content) {
      const item = itemOf(block);
      if (!item) continue;
      copyPointer(source, exported, item);
      approvedItems.push(resolvePointer(source, item));
    }
  } else {
    const items = resolvePointer(source, selection.items);
    const kept = Array.isArray(items)
      ? [...new Set(approved)]
          .filter((index) => index < items.length)
          .sort((a, b) => a - b)
      : [];
    approvedItems = Array.isArray(items)
      ? kept.map((index) => items[index])
      : [];
    if (Array.isArray(items))
      setPointer(exported, selection.items, approvedItems);
    content = result.content.flatMap((block) => {
      const item = itemOf(block);
      const prefix = `${selection.items}/`;
      if (!item?.startsWith(prefix)) return [];
      const [position = "", ...rest] = item.slice(prefix.length).split("/");
      const to = kept.indexOf(Number(position));
      if (to === -1) return [];
      return [
        {
          ...block,
          _meta: {
            ...block._meta,
            "ai.erato/item": [`${prefix}${to}`, ...rest].join("/"),
          },
        },
      ];
    });
  }
  for (const { pointer, itemKey } of selection.itemMetadata ?? []) {
    const entries = resolvePointer(source, pointer);
    if (!Array.isArray(entries)) continue;
    const approvedKeys = new Set(
      approvedItems.map((item) => fieldOf(item, itemKey)),
    );
    setPointer(
      exported,
      pointer,
      entries.flatMap((entry) => {
        const key = fieldOf(entry, itemKey);
        if (key !== undefined && !approvedKeys.has(key)) return [];
        const code = String(fieldOf(entry, "code"));
        return [
          {
            code,
            message:
              FIXED_WARNING_MESSAGES[code] ??
              "Part of the result could not be represented.",
            ...(key === undefined ? {} : { [itemKey]: key }),
          },
        ];
      }),
    );
  }
  return { result: { content, structuredContent: exported } };
}

function fieldOf(value: unknown, key: string): unknown {
  return value !== null &&
    typeof value === "object" &&
    Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** The value an RFC 6901 JSON pointer names, or undefined. */
function resolvePointer(value: unknown, pointer: string): unknown {
  return pointerTokens(pointer).reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === "object" && Object.hasOwn(node, key)
        ? (node as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}

function setPointer(
  target: Record<string, unknown>,
  pointer: string,
  value: unknown,
): void {
  const tokens = pointerTokens(pointer);
  const last = tokens.pop();
  if (last === undefined) return;
  let node = target;
  for (const token of tokens) {
    const next = node[token];
    node[token] =
      next !== null && typeof next === "object" && !Array.isArray(next)
        ? next
        : {};
    node = node[token] as Record<string, unknown>;
  }
  node[last] = value;
}

function copyPointer(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  pointer: string,
): void {
  const value = resolvePointer(source, pointer);
  if (value !== undefined) setPointer(target, pointer, value);
}

function pointerTokens(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function callError(
  code: number,
  message: string,
  data?: Record<string, unknown>,
): JobCallResult {
  return { error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/**
 * Keep a job's serialized results within `budget` bytes: a call whose result
 * would exceed what remains gets the error an oversized direct export
 * returns, and the other calls keep theirs.
 */
function withinResponseBudget(
  results: JobCallResult[],
  budget: number,
): JobCallResult[] {
  let remaining = budget;
  return results.map((entry) => {
    const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
    const kept =
      bytes <= remaining
        ? entry
        : callError(-32016, "The sidecar could not complete the request.", {
            kind: "sidecar_internal",
            sourceError: "export_too_large",
          });
    remaining -=
      kept === entry ? bytes : Buffer.byteLength(JSON.stringify(kept)) + 1;
    return kept;
  });
}

/**
 * Hold the response while the job stays in the pending state `from` (queued
 * and running count as one), for at most `waitMs`.
 */
async function waitForJob(
  job: MockJob,
  waitMs = 0,
  from = phaseOf(job.state),
): Promise<void> {
  if (!PENDING_JOB_STATES.has(job.state) || phaseOf(job.state) !== from) return;
  const boundedMs = Math.min(waitMs, MAX_JOB_WAIT_MS);
  if (boundedMs <= 0) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      job.waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, boundedMs);
    job.waiters.add(done);
  });
}

function phaseOf(state: JobStatus["state"]): JobStatus["state"] {
  return state === "queued" ? "running" : state;
}

/** Move the job to a new state and answer the long-polls waiting on it. */
function settleJob(job: MockJob, state: JobStatus["state"]): void {
  job.state = state;
  for (const waiter of [...job.waiters]) waiter();
}

/**
 * The job's status as a response reports it. A response that reports results
 * as `completed` or `approved` delivers them, so the job is `read` afterwards.
 */
function reportJob(handle: string, job: MockJob): JobStatus {
  if (!job.results) return { handle, state: job.state };
  const status: JobStatus = {
    handle,
    state: job.state,
    results: job.results,
  };
  if (job.state === "completed" || job.state === "approved") job.state = "read";
  return status;
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
