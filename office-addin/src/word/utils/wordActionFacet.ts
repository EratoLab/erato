import type { WordDocumentArgs } from "./buildWordDocumentArgs";
import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { ActionFacetRequest } from "@erato/frontend/library";

/** Config-defined in `erato-action-facets.toml` (ERMAIN-820), not a builtin. */
export const WORD_DOCUMENT_REVIEW_FACET_ID = "word_document_review";
export const WORD_AUTHORING_FACET_ID = "word_document_authoring";
export const WORD_COMPOSE_FACET_ID = "word_compose";

export interface WordActionFacetInput {
  /** The include-document chip is on for this chat. */
  chipEnabled: boolean;
  /** Document name as Word reports it; `""` for an unsaved document. */
  documentName: string;
  /** URL when saved, `pane-session:<uuid>` when not. */
  documentIdentity: string;
  /**
   * The built arguments, or `null` when the read failed or the host was not
   * available. A failed read must never block the send, so it simply attaches
   * no document-bearing facet.
   */
  documentArgs: WordDocumentArgs | null;
  /** At least one paragraph carries text. */
  hasContent: boolean;
  authoring?: WordAuthoringSnapshot;
  /**
   * Facet ids `GET /me/facets` advertises. A facet id the backend does not
   * know hard-400s the whole send (`validate_action_facet`), so a facet is
   * only ever attached when it is advertised — the same gate Outlook applies
   * to `compose_email`.
   */
  availableFacetIds: ReadonlySet<string>;
}

/**
 * Choose an advertised facet: authoring when a snapshot exists, otherwise
 * review for nonempty text or compose for an empty document. A disabled chip
 * or failed read attaches none.
 *
 * Emit all declared arguments, using empty strings where needed: unmatched
 * placeholders would otherwise reach the model literally. Include document
 * context on every send because prior-turn facet directives are stripped
 * from replayed history.
 */
export function resolveWordActionFacet(
  input: WordActionFacetInput,
): ActionFacetRequest | undefined {
  if (!input.chipEnabled) return undefined;
  // A rejected `Word.run` or an Office.js host that never became ready.
  if (input.documentArgs === null) return undefined;

  if (input.authoring && input.availableFacetIds.has(WORD_AUTHORING_FACET_ID)) {
    return {
      id: WORD_AUTHORING_FACET_ID,
      args: {
        document_name: input.documentName,
        document_identity: input.documentIdentity,
        ...input.documentArgs,
        document_snapshot: input.authoring.token,
        authoring_status: input.authoring.issue
          ? `${input.authoring.issue}${input.authoring.issueDetails?.length ? ` (${input.authoring.issueDetails.join(", ")})` : ""}`
          : "available",
      },
    };
  }
  if (input.hasContent) {
    if (!input.availableFacetIds.has(WORD_DOCUMENT_REVIEW_FACET_ID)) {
      return undefined;
    }
    return {
      id: WORD_DOCUMENT_REVIEW_FACET_ID,
      args: {
        document_name: input.documentName,
        document_text: input.documentArgs.document_text,
        heading_outline: input.documentArgs.heading_outline,
        paragraphs_sent: input.documentArgs.paragraphs_sent,
        paragraphs_total: input.documentArgs.paragraphs_total,
        truncation_note: input.documentArgs.truncation_note,
        document_identity: input.documentIdentity,
      },
    };
  }

  if (!input.availableFacetIds.has(WORD_COMPOSE_FACET_ID)) return undefined;
  return {
    id: WORD_COMPOSE_FACET_ID,
    args: {
      document_name: input.documentName,
      document_identity: input.documentIdentity,
    },
  };
}
