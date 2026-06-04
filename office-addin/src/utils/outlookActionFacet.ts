import type { ActionFacetRequest } from "@erato/frontend/library";

/**
 * Inputs for deciding which Outlook action facet (if any) rides along with a
 * chat message. Pure data — no Office.js, no React — so the selection-vs-draft
 * priority and the draft de-duplication are unit-testable in isolation.
 */
export interface OutlookActionFacetInput {
  /** A compose selection is active and not dismissed. */
  hasActiveSelection: boolean;
  /** The selected text (only meaningful when `hasActiveSelection`). */
  selectionData: string;
  /** Where the selection came from. */
  selectionSource: "body" | "subject";
  /**
   * The draft is eligible to be sent as `outlook_review_draft`: compose mode,
   * a non-empty body, and the user hasn't switched off the draft chip. Encodes
   * change #1 — the user-controllable toggle. When false the draft is never
   * attached, even if non-empty.
   */
  draftContextIncluded: boolean;
  /** Plain-text coercion of the draft body. */
  draftBody: string;
  /**
   * The draft body last sent as `outlook_review_draft` in this chat, or `null`
   * if none yet. Encodes change #4 — client-side de-dup. (The backend is
   * intentionally action-facet toggle-stateless and strips prior-turn facet
   * directives on replay, so the "did we already send this?" memory must live
   * on the client.)
   */
  lastSentDraftBody: string | null;
  /** Compose body format; included in the rewrite facet args when known. */
  bodyFormat?: string;
  /** The user is in an Outlook compose context (reply/new mail), body may be empty. */
  isComposeMode: boolean;
  /**
   * Whether the backend reports the `compose_email` facet as available (from
   * `GET /me/facets`). `compose_email` is config-defined (erato.toml only), and
   * sending an unknown facet id hard-400s the request — so it is ONLY attached
   * when the backend advertises it. A customer without the facet leaves this
   * false and the empty-draft case simply sends no facet (today's behavior).
   */
  composeEmailAvailable: boolean;
}

export interface OutlookActionFacetResult {
  /** The facet to attach, or `undefined` when none applies. */
  facet: ActionFacetRequest | undefined;
  /**
   * When a `review_draft` facet was produced, the body to remember so the next
   * unchanged send de-dupes. `null` means "leave the dedup marker untouched" —
   * i.e. selection sends and skipped/unchanged drafts.
   */
  sentDraftBody: string | null;
}

/**
 * Decide which action facet a compose-mode send should carry.
 *
 * Priority mirrors the facet design: an active selection is a *rewrite* action
 * and wins; otherwise an included, **changed** draft is sent for review. A
 * draft whose body is identical to the one we last sent is skipped — the
 * builtin template already tells the model to "respond normally" on a follow-up
 * without a new draft, and the backend strips prior-turn facet directives, so
 * re-sending the same body only burns tokens.
 */
export function resolveOutlookActionFacet(
  input: OutlookActionFacetInput,
): OutlookActionFacetResult {
  if (input.hasActiveSelection) {
    return {
      facet: {
        id: "outlook_rewrite_selection",
        args: {
          selected_text: input.selectionData,
          source_property: input.selectionSource,
          ...(input.bodyFormat ? { body_format: input.bodyFormat } : {}),
        },
      },
      // A selection send never touches the draft dedup marker.
      sentDraftBody: null,
    };
  }

  if (
    input.draftContextIncluded &&
    input.draftBody.length > 0 &&
    input.draftBody !== input.lastSentDraftBody
  ) {
    return {
      facet: {
        id: "outlook_review_draft",
        args: {
          full_body: input.draftBody,
          body_format: "text",
        },
      },
      sentDraftBody: input.draftBody,
    };
  }

  // Compose-from-scratch: an empty compose draft where the user wants an email
  // written. Distinct, detectable context (no selection, compose mode, empty
  // body) — unlike review_draft, which requires a non-empty body. Gated on
  // availability because the unknown-facet path hard-400s the send.
  if (
    input.composeEmailAvailable &&
    input.isComposeMode &&
    !input.hasActiveSelection &&
    input.draftBody.trim().length === 0
  ) {
    return {
      facet: {
        id: "compose_email",
        args: { body_format: input.bodyFormat ?? "text" },
      },
      sentDraftBody: null,
    };
  }

  return { facet: undefined, sentDraftBody: null };
}
