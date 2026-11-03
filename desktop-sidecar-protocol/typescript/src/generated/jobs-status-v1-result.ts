/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * The outcome of one call, at the call's position in `calls`: its `result`, or a JSON-RPC error object when the call does not run or its result exceeds the response budget.
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
/**
 * A reference to one Outlook message, preserving its own identifiers and mailbox context. This is metadata, not an instruction or proof that the item is accessible.
 */
export type OutlookMessageReference = (
  | {
      /**
       * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
       */
      documentId: string;
      [k: string]: unknown;
    }
  | {
      /**
       * @minItems 1
       */
      external_ids?: [unknown, ...unknown[]];
      [k: string]: unknown;
    }
) & {
  /**
   * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
   */
  documentId?: string;
  external_ids: DocumentExternalIds &
    {
      key?: unknown;
      value?: unknown;
      [k: string]: unknown;
    }[];
  mailbox?: OutlookMailboxReference;
  [k: string]: unknown;
} & (
    | {
        /**
         * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
         */
        documentId: string;
        [k: string]: unknown;
      }
    | {
        /**
         * @minItems 1
         */
        external_ids?: [unknown, ...unknown[]];
        [k: string]: unknown;
      }
  ) & {
    /**
     * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
     */
    documentId?: string;
    external_ids: DocumentExternalIds &
      {
        key?: unknown;
        value?: unknown;
        [k: string]: unknown;
      }[];
    mailbox?: OutlookMailboxReference;
    [k: string]: unknown;
  };
/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
  [k: string]: unknown;
}[];
/**
 * Mailbox context captured with a message reference. Local IDs are scoped to the originating Outlook installation; emailAddress identifies the mailbox owner, including a shared mailbox, not necessarily the signed-in user.
 */
export type OutlookMailboxReference = (
  | {
      /**
       * Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.
       */
      mailboxId: string;
      [k: string]: unknown;
    }
  | {
      /**
       * SMTP address of the mailbox owning the referenced item, when known.
       */
      emailAddress: string;
      [k: string]: unknown;
    }
) & {
  /**
   * Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.
   */
  mailboxId?: string;
  /**
   * SMTP address of the mailbox owning the referenced item, when known.
   */
  emailAddress?: string;
  /**
   * Name of the originating Outlook profile, when available. A profile name alone does not identify a mailbox.
   */
  profileName?: string;
  [k: string]: unknown;
};

export interface JobsStatusV1Result {
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
   * One entry per call, in call order. Present whenever the reported state is `completed`, `approved` or `read`. Their serialized size stays within the client's response cap: a call whose result would exceed the remaining budget gets the `sidecar_internal` error with `sourceError: "export_too_large"`.
   */
  results?: JobCallResult[];
  [k: string]: unknown;
}
/**
 * A call's result as the MCP `CallToolResult`, for every provider. For the `sidecar` provider, `structuredContent` is a `SidecarStructuredContent`, the raw outcomes of the RPC methods the tool composed, and `content` carries their files as embedded resources.
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
 * Metadata under reverse-DNS-namespaced keys, `<prefix>/<name>`. MCP reserves prefixes with a `modelcontextprotocol` or `mcp` label, such as `modelcontextprotocol.io/`; Erato uses `ai.erato/`. A content block's metadata is item-level and travels only with its item.
 */
export interface ResultMeta {
  /**
   * The JSON pointer into `structuredContent` of the object this block belongs to: for a file, the object its bytes were taken from.
   */
  "ai.erato/item"?: string;
  /**
   * Where a file came from: the message's own reference as `document`, or an attachment's containing message as `topLevelParent`. A navigation hint for opening the original, never a grant.
   */
  "ai.erato/outlookProvenance"?: OutlookFileProvenance;
  [k: string]: unknown;
}
/**
 * Versioned Outlook source metadata for an uploaded file. Multiple origins preserve distinct containing messages when identical bytes are deduplicated. This standalone contract does not add a field to existing v1 RPC responses.
 */
export interface OutlookFileProvenance {
  version: 1;
  /**
   * @minItems 1
   */
  origins: [
    {
      /**
       * The uploaded email's own message reference. Omit for an ordinary file attachment with no message identity. For a thread export, identifies the requested subject only.
       */
      document?: OutlookMessageReference;
      /**
       * The outermost containing mailbox message. Never substitute this reference for the uploaded document's own identity.
       */
      topLevelParent?: OutlookMessageReference;
      [k: string]: unknown;
    },
    ...{
      /**
       * The uploaded email's own message reference. Omit for an ordinary file attachment with no message identity. For a thread export, identifies the requested subject only.
       */
      document?: OutlookMessageReference;
      /**
       * The outermost containing mailbox message. Never substitute this reference for the uploaded document's own identity.
       */
      topLevelParent?: OutlookMessageReference;
      [k: string]: unknown;
    }[],
  ];
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
