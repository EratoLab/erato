/**
 * Basic types for chat functionality
 * These are placeholder types for the new implementation
 */

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export type ContentFilterCategory =
  | "hate"
  | "self_harm"
  | "sexual"
  | "violence";
export type ContentFilterSeverity = "safe" | "low" | "medium" | "high" | string;

export interface MessageErrorFilterDetail {
  filtered: boolean;
  severity: ContentFilterSeverity;
}

export type MessageErrorFilterDetails = Partial<
  Record<ContentFilterCategory, MessageErrorFilterDetail>
>;

export interface MessageError {
  error_description: string;
  error_type: string;
  filter_details?: MessageErrorFilterDetails | null;
}

/**
 * Render hint set on an ASSISTANT message whose triggering user message carried
 * an Outlook action facet. Lets the renderer treat the response as an
 * insert/replace email artifact independent of whether the model emitted the
 * exact `erato-email` fence tag (newer models often drift the tag or omit it).
 *
 * Resolved by the Outlook add-in from the assistant message's
 * `previous_message_id` → the user message's `action_facet_id`/`action_facet_args`.
 * The web app never sets this, so its rendering is unchanged.
 *
 * `facetId` is intentionally a free `string`: the renderer is driven by the
 * fields below, NOT by an id allowlist, so action facets added only in
 * `erato.toml` (no code change) render correctly.
 */
export interface OutlookArtifact {
  /** The action facet id that produced this assistant message (free-form). */
  facetId: string;
  /** Output format the facet requested; drives HTML-vs-text rendering. */
  bodyFormat: "text" | "html";
  /**
   * How to treat the assistant's output:
   * - `"body"`: the whole response is a single insertable email body, so an
   *   unfenced response falls back to rendering the entire text as the artifact
   *   (compose / rewrite-style facets). This is the default for any new facet.
   * - `"suggestions"`: the response is feedback that may *contain* fenced email
   *   blocks (review/critique). Fenced blocks still render as artifacts, but
   *   unfenced prose is left as normal markdown — never treated as a drop-in body.
   */
  renderMode: "body" | "suggestions";
  /**
   * Client actions the backend allows for the producing facet (the facet's
   * `client_actions` from `GET /me/facets`). The renderer must only offer
   * actions from this list, further intersected with the actions the client
   * actually implements.
   */
  allowedClientActions?: string[];
  /**
   * The client action the model proposed for this message via the
   * `propose_client_action` tool, already validated by the add-in against
   * {@link OutlookArtifact.allowedClientActions} and the tool-call status.
   * Used as a render hint (e.g. which button is primary) — never executed
   * without an explicit user click.
   */
  proposedClientAction?: string;
}

export interface Message {
  id: string;
  content: ContentPart[];
  role: "user" | "assistant" | "system";
  createdAt: string;
  /**
   * Last-modified timestamp from the backend (ISO-8601). Set on persisted
   * messages; missing on optimistic placeholders pre-stream.
   */
  updatedAt?: string;
  input_files_ids?: string[];
  status?: "sending" | "complete" | "error";
  error?: MessageError;
  mcp_servers_unavailable?: string[];
  previous_message_id?: string;
  // Whether this message is in the active thread per backend lineage logic
  is_message_in_active_thread?: boolean;
  /** The action facet ID supplied with this user message, if any. */
  action_facet_id?: string;
  /** The action facet arguments supplied with this user message, if any. */
  action_facet_args?: Record<string, string>;
  /**
   * Set on assistant messages produced under an Outlook action facet — drives
   * insert/replace email-artifact rendering in {@link Message} content
   * regardless of the model's fence tag. See {@link OutlookArtifact}.
   */
  outlookArtifact?: OutlookArtifact;
}

// Metadata for a chat session
export interface ChatSessionMetadata {
  ownerId?: string;
  lastMessage?: {
    content: string;
    timestamp: string;
    sender?: "user" | "assistant" | "system";
  };
  fileCount?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  titleResolved?: string;
  titleBySummary?: string | null;
  titleByUserProvided?: string | null;
  canEdit?: boolean;
  updatedAt: string;
  messages: Message[];
  metadata?: ChatSessionMetadata;
  assistantId?: string | null;
}
