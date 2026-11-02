/* This file is generated from the canonical JSON schemas. Do not edit. */

export type ContentBlock = TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink;
export type Base64 = string;

/**
 * A call's result as the MCP `CallToolResult`, for every provider. For the `sidecar` provider, `structuredContent` is the tool's JSON result as the frontend returns it today, byte-compatible with the normal-mode result except that the `fileId` an upload assigns is left out, and `content` carries its plain-text rendering and its files as embedded resources.
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
  data: Base64;
  mimeType: string;
  annotations?: ContentAnnotations;
  _meta?: ResultMeta;
  [k: string]: unknown;
}
export interface AudioContent {
  type: "audio";
  data: Base64;
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
  blob: Base64;
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
