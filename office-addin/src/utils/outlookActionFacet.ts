import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "./outlookClientActions";
import { OUTLOOK_SCHEDULE_FACET_ID } from "./outlookScheduleTool";

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
  /** The user is reading a received email (read mode, not compose). */
  isReadMode: boolean;
  /**
   * Whether the backend reports the `outlook_reply_from_read` facet as
   * available (from `GET /me/facets`). Config-defined (erato.toml only) and
   * gated exactly like `compose_email`: never attached unless advertised.
   */
  replyFromReadAvailable: boolean;
  /**
   * Whether the backend reports the `outlook_schedule` facet as available
   * (from `GET /me/facets`). Config-defined and gated like the others.
   */
  scheduleFacetAvailable: boolean;
  /**
   * A calendar fetch backend applies to this session (see
   * `useOutlookCalendarFetcher`). Without one the `fetch_availability` client
   * tool could only ever error, so the scheduling facet is never attached.
   */
  calendarAvailable: boolean;
  /**
   * The latest assistant message RECENTLY read the calendar
   * (`fetch_availability` tool use; recency is judged by the caller at send
   * time via `isSchedulingThreadFresh`) — the user's follow-up most likely
   * picks one of the presented slots, so the scheduling facet must claim the
   * single facet slot even in read/compose contexts that normally attach an
   * email facet.
   */
  schedulingThreadActive: boolean;
  /** Send-time "now" as a local, offset-bearing ISO string (facet arg). */
  nowIso: string;
  /** The user's IANA time zone id (facet arg). */
  timezone: string;
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
  const scheduleReady = input.scheduleFacetAvailable && input.calendarAvailable;
  const scheduleFacet = (): OutlookActionFacetResult => ({
    facet: {
      id: OUTLOOK_SCHEDULE_FACET_ID,
      args: { now_iso: input.nowIso, timezone: input.timezone },
    },
    // A scheduling send never touches the draft dedup marker.
    sentDraftBody: null,
  });

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

  // Sticky scheduling: a FRESH scheduling exchange (the model recently read
  // the calendar — recency-bounded upstream) outranks the email facets — the
  // follow-up is the user picking a slot, and only the schedule facet's
  // template handles that. One rung below selection: highlighting text is a
  // stronger, explicit gesture. Known v1 trade-offs (one facet per turn until
  // ERMAIN-414), both self-healing on the following send: (a) asking for a
  // reply draft right after a scheduling exchange misses the reply facet for
  // that turn; (b) worse, a sticky-claimed "review this" turn is BLIND to the
  // draft — the draft body only ever rides as the review facet's `full_body`
  // arg, so the model doesn't just lose the review template, it never sees
  // the draft at all.
  if (scheduleReady && input.schedulingThreadActive) {
    return scheduleFacet();
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

  // Read mode: the user is looking at a received email. The facet primes the
  // model to draft a reply (in an erato-email fence) and to propose
  // reply-vs-reply-all via the backend's `propose_client_action` tool when —
  // and only when — the user actually asks for a reply; other requests are
  // answered normally. The reply form prefill is HTML, so request html output.
  if (input.replyFromReadAvailable && input.isReadMode) {
    return {
      facet: {
        id: OUTLOOK_REPLY_FROM_READ_FACET_ID,
        args: { body_format: "html" },
      },
      sentDraftBody: null,
    };
  }

  // Ambient scheduling: a NEUTRAL context (no Outlook item — e.g. the pinned
  // taskpane with nothing selected) attaches the schedule facet so "find me a
  // slot" works from a blank chat. Read/compose contexts are deliberately
  // excluded: their email facets own those turns, and the fetch tool is
  // reachable there via the `tool_call_allowlist` on `outlook_reply_from_read`
  // (read mode), `compose_email` (empty compose) and `outlook_review_draft`
  // (draft review). Not covered: a selection-rewrite turn, and an
  // unchanged-deduped-draft compose turn, which attaches no facet at all.
  if (scheduleReady && !input.isComposeMode && !input.isReadMode) {
    return scheduleFacet();
  }

  return { facet: undefined, sentDraftBody: null };
}
