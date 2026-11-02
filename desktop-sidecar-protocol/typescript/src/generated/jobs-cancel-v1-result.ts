/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * The outcome of one call, at the call's position in `calls`: its `result`, or the JSON-RPC error object a direct request for the same work would have returned.
 */
export type JobCallResult =
  | {
      result: CallToolResult;
      [k: string]: unknown;
    }
  | {
      error: JsonRpcError;
      [k: string]: unknown;
    };
export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink;

export interface JobsCancelV1Result {
  handle: string;
  /**
   * `awaiting_approval`, `ready_for_review` and `approved` occur only under strict mode; `awaiting_approval` is reserved for effectful tools. `acked`, `declined`, `cancelled`, `expired` and `failed` are terminal.
   */
  state:
    | "queued"
    | "running"
    | "awaiting_approval"
    | "ready_for_review"
    | "approved"
    | "completed"
    | "read"
    | "acked"
    | "declined"
    | "cancelled"
    | "expired"
    | "failed";
  /**
   * One entry per call, in call order. Present whenever the reported state is `completed`, `approved` or `read`.
   */
  results?: JobCallResult[];
  [k: string]: unknown;
}
/**
 * A call's result as the MCP `CallToolResult`, for every provider. For the `sidecar` provider, `structuredContent` is the tool's JSON result, byte-compatible with the normal-mode result, and `content` carries its plain-text rendering and its files as embedded resources.
 */
export interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: {
    [k: string]: unknown;
  };
  isError?: boolean;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface TextContent {
  type: "text";
  text: string;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface ContentAnnotations {
  audience?: ("user" | "assistant")[];
  priority?: number;
  lastModified?: string;
  [k: string]: unknown;
}
/**
 * Metadata under reverse-DNS-namespaced keys, `<prefix>/<name>`. MCP reserves prefixes with a `modelcontextprotocol` or `mcp` label, such as `modelcontextprotocol.io/`; Erato uses `ai.erato/`.
 */
export interface ResultMeta {
  [k: string]: unknown;
}
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface AudioContent {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface EmbeddedResource {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface TextResourceContents {
  uri: string;
  mimeType?: string;
  text: string;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface BlobResourceContents {
  uri: string;
  mimeType?: string;
  blob: string;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
/**
 * A reference to a resource the result does not embed. Under strict mode it is exported as a reference only.
 */
export interface ResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
  [k: string]: unknown;
}
