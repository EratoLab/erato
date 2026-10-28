import { OUTLOOK_REPLY_FROM_READ_FACET_ID } from "./outlookClientActions";
import { OUTLOOK_SCHEDULE_FACET_ID } from "./outlookScheduleTool";

import type { ActionFacetRequest } from "@erato/frontend/library";

/**
 * Inputs for deciding which Outlook action facet (if any) rides along with a
 * chat message. Pure data — no Office.js, no React — so the selection-vs-draft
 * priority and the draft de-duplication are unit-testable in isolation.
 */
export interface OutlookActionFacetInput {
  /** Current Outlook item kind; null for the pinned neutral surface. */
  itemKind: "message" | "appointment" | null;
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
   * The draft-context fingerprint last sent in this chat, or `null` if none
   * yet: body plus supported recipient context for message drafts, the JSON
   * metadata+description fingerprint for appointments. Encodes
   * change #4 — client-side de-dup. (The backend is intentionally
   * action-facet toggle-stateless and strips prior-turn facet directives on
   * replay, so the "did we already send this?" memory must live on the
   * client.)
   */
  lastSentDraftFingerprint: string | null;
  /** Explicit de-dup key for appointment metadata + description. */
  draftContextFingerprint?: string;
  /** Compose body format; included in the rewrite facet args when known. */
  bodyFormat?: string;
  /** JSON To/CC/BCC context; only attached when the server accepts the argument. */
  recipients?: string;
  availableFacetArgs?: ReadonlyMap<string, ReadonlySet<string>>;
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
  /** Backend advertises the appointment-specific selection facet. */
  appointmentRewriteAvailable?: boolean;
  /** Backend advertises the appointment-specific context facet. */
  appointmentContextAvailable?: boolean;
  appointmentSubject?: string;
  appointmentRequiredAttendees?: string;
  appointmentOptionalAttendees?: string;
  appointmentLocation?: string;
  appointmentStart?: string;
  appointmentEnd?: string;
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
   * The latest assistant message RECENTLY read the calendar or
   * proposed/adjusted an appointment (`containsSchedulingSignal`; recency is
   * judged by the caller at send time via `isSchedulingThreadFresh`) — the
   * user's follow-up most likely picks or tweaks a slot, so the scheduling
   * facet must claim the single facet slot even in read/compose contexts that
   * normally attach an email facet.
   */
  schedulingThreadActive: boolean;
  /** Send-time "now" as a local, offset-bearing ISO string (facet arg). */
  nowIso: string;
  /** The user's IANA time zone id (facet arg). */
  timezone: string;
}

/**
 * What became of the user's draft (or appointment details) on this send:
 * attached for review (`sent`), replaced by a selection rewrite, held back by
 * sticky scheduling, skipped as identical to the last send (`unchanged`), or
 * not in play at all (`none`).
 */
export type OutlookDraftDisposition =
  | "none"
  | "sent"
  | "selection"
  | "scheduling"
  | "unchanged";

export interface OutlookActionFacetResult {
  /** The facet to attach, or `undefined` when none applies. */
  facet: ActionFacetRequest | undefined;
  draft: OutlookDraftDisposition;
  /**
   * When a review facet was produced, the fingerprint to remember so the next
   * unchanged send de-dupes (body and recipients for message drafts, metadata fingerprint
   * for appointments). `null` means "leave the dedup marker untouched" — i.e.
   * selection sends and skipped/unchanged drafts.
   */
  sentDraftFingerprint: string | null;
}

type OutlookDraftFingerprintInput = Pick<
  OutlookActionFacetInput,
  | "itemKind"
  | "isComposeMode"
  | "recipients"
  | "availableFacetArgs"
  | "draftBody"
  | "draftContextFingerprint"
>;

function reviewDraftRecipients(
  input: OutlookDraftFingerprintInput,
): string | undefined {
  return input.itemKind === "message" &&
    input.isComposeMode &&
    input.recipients !== undefined &&
    input.availableFacetArgs?.get("outlook_review_draft")?.has("recipients")
    ? input.recipients
    : undefined;
}

/** The de-dup key of the draft context a review send would carry. */
export function outlookDraftFingerprint(
  input: OutlookDraftFingerprintInput,
): string {
  if (input.draftContextFingerprint !== undefined) {
    return input.draftContextFingerprint;
  }
  const recipients = reviewDraftRecipients(input);
  return recipients !== undefined
    ? JSON.stringify({ body: input.draftBody, recipients })
    : input.draftBody;
}

export interface OutlookAppointmentFingerprintFields {
  subject: string;
  requiredAttendees: readonly { displayName: string; emailAddress: string }[];
  optionalAttendees: readonly { displayName: string; emailAddress: string }[];
  location: string;
  start: Date | null;
  end: Date | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

/**
 * The de-dup key for appointment metadata and description. The provider's
 * bind-time item and the send's live snapshot come from the same reader, so
 * equal values give one key whichever side computed it.
 */
export function outlookAppointmentFingerprint(
  fields: OutlookAppointmentFingerprintFields,
): string {
  return JSON.stringify({
    subject: fields.subject,
    body: fields.bodyText ?? fields.bodyHtml ?? "",
    requiredAttendees: fields.requiredAttendees,
    optionalAttendees: fields.optionalAttendees,
    location: fields.location,
    start: fields.start?.toISOString() ?? "",
    end: fields.end?.toISOString() ?? "",
  });
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
  const { itemKind } = input;
  const recipientArgs = (facetId: string): Record<string, string> =>
    itemKind === "message" &&
    input.isComposeMode &&
    input.recipients !== undefined &&
    input.availableFacetArgs?.get(facetId)?.has("recipients")
      ? { recipients: input.recipients }
      : {};
  const reviewRecipientArgs = recipientArgs("outlook_review_draft");
  const draftFingerprint = outlookDraftFingerprint(input);
  const draftEligible =
    input.draftContextIncluded &&
    (itemKind === "appointment" || input.draftBody.length > 0);
  const draftUnchanged =
    draftEligible && draftFingerprint === input.lastSentDraftFingerprint;
  // Every branch past the review one leaves the draft out: either it was
  // already sent unchanged, or it was never in play.
  const passedOver: OutlookDraftDisposition = draftUnchanged
    ? "unchanged"
    : "none";
  const scheduleReady = input.scheduleFacetAvailable && input.calendarAvailable;
  const scheduleFacet = (
    draft: OutlookDraftDisposition,
  ): OutlookActionFacetResult => ({
    facet: {
      id: OUTLOOK_SCHEDULE_FACET_ID,
      args: { now_iso: input.nowIso, timezone: input.timezone },
    },
    draft,
    // A scheduling send never touches the draft dedup marker.
    sentDraftFingerprint: null,
  });

  if (input.hasActiveSelection) {
    if (itemKind === "appointment" && !input.appointmentRewriteAvailable) {
      return { facet: undefined, draft: "none", sentDraftFingerprint: null };
    }
    return {
      facet: {
        id:
          itemKind === "appointment"
            ? "outlook_rewrite_appointment_selection"
            : "outlook_rewrite_selection",
        args: {
          ...recipientArgs("outlook_rewrite_selection"),
          selected_text: input.selectionData,
          source_property: input.selectionSource,
          ...(input.bodyFormat ? { body_format: input.bodyFormat } : {}),
        },
      },
      // A draft already sent unchanged would not go without the selection
      // either, so the selection replaces nothing.
      draft: draftUnchanged
        ? "unchanged"
        : draftEligible
          ? "selection"
          : "none",
      // A selection send never touches the draft dedup marker.
      sentDraftFingerprint: null,
    };
  }

  // Sticky scheduling: a FRESH scheduling exchange (the model recently read
  // the calendar OR proposed/adjusted an appointment — recency-bounded
  // upstream) outranks the email facets — the follow-up is the user picking
  // or tweaking a slot, and only the schedule facet's template handles that.
  // One rung below selection: highlighting text is a
  // stronger, explicit gesture. Known v1 trade-offs (one facet per turn until
  // ERMAIN-414), both self-healing on the following send: (a) asking for a
  // reply draft right after a scheduling exchange misses the reply facet for
  // that turn; (b) worse, a sticky-claimed "review this" turn is BLIND to the
  // draft — the draft body only ever rides as the review facet's `full_body`
  // arg, so the model doesn't just lose the review template, it never sees
  // the draft at all.
  //
  // Never on appointment composes: the schedule facet's confirm path opens a
  // NEW appointment, which is never the right continuation while the user is
  // already editing one — and each proposal it produces would refresh the
  // stickiness window, locking the chat into scheduling. The review facet
  // owns this surface; calendar reads stay reachable mid-turn through its
  // tool allowlist.
  if (
    scheduleReady &&
    input.schedulingThreadActive &&
    itemKind !== "appointment"
  ) {
    return scheduleFacet(
      draftUnchanged ? "unchanged" : draftEligible ? "scheduling" : "none",
    );
  }

  if (draftEligible && !draftUnchanged) {
    if (itemKind === "appointment") {
      if (!input.appointmentContextAvailable) {
        return { facet: undefined, draft: "none", sentDraftFingerprint: null };
      }
      return {
        facet: {
          id: "outlook_review_appointment",
          args: {
            subject: input.appointmentSubject ?? "",
            full_body: input.draftBody,
            required_attendees: input.appointmentRequiredAttendees ?? "",
            optional_attendees: input.appointmentOptionalAttendees ?? "",
            location: input.appointmentLocation ?? "",
            start: input.appointmentStart ?? "",
            end: input.appointmentEnd ?? "",
            body_format: "text",
            timezone: input.timezone,
          },
        },
        draft: "sent",
        sentDraftFingerprint: draftFingerprint,
      };
    }
    return {
      facet: {
        id: "outlook_review_draft",
        args: {
          ...reviewRecipientArgs,
          full_body: input.draftBody,
          body_format: "text",
        },
      },
      draft: "sent",
      sentDraftFingerprint: draftFingerprint,
    };
  }

  // Compose-from-scratch: an empty compose draft where the user wants an email
  // written. Distinct, detectable context (no selection, compose mode, empty
  // body) — unlike review_draft, which requires a non-empty body. Gated on
  // availability because the unknown-facet path hard-400s the send.
  if (
    input.composeEmailAvailable &&
    itemKind === "message" &&
    input.isComposeMode &&
    !input.hasActiveSelection &&
    input.draftBody.trim().length === 0
  ) {
    return {
      facet: {
        id: "compose_email",
        args: {
          ...recipientArgs("compose_email"),
          body_format: input.bodyFormat ?? "text",
        },
      },
      draft: passedOver,
      sentDraftFingerprint: null,
    };
  }

  // Read mode: the user is looking at a received email. The facet primes the
  // model to draft a reply (in an erato-email fence) and to propose
  // reply-vs-reply-all via the backend's `propose_client_action` tool when —
  // and only when — the user actually asks for a reply; other requests are
  // answered normally. The reply form prefill is HTML, so request html output.
  if (
    input.replyFromReadAvailable &&
    itemKind === "message" &&
    input.isReadMode
  ) {
    return {
      facet: {
        id: OUTLOOK_REPLY_FROM_READ_FACET_ID,
        args: { body_format: "html" },
      },
      draft: passedOver,
      sentDraftFingerprint: null,
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
    return scheduleFacet(passedOver);
  }

  return { facet: undefined, draft: passedOver, sentDraftFingerprint: null };
}

/**
 * What the last send of a draft left behind for the chip to compare against.
 * `sent` is the fingerprint the send attached, from the draft it read off the
 * live item; render time keeps that read as well, so both compare the same
 * draft. `recipients` are the live recipients that send read; they stand in
 * until render time reads them itself.
 */
export interface OutlookSentDraft {
  sent: string;
  recipients?: string;
}

export type OutlookSendPreviewInput = Omit<
  OutlookActionFacetInput,
  "lastSentDraftFingerprint" | "recipients" | "nowIso" | "timezone"
> & {
  lastSentDraft: OutlookSentDraft | null;
  /** Recipients as render time last read them, if it has. */
  liveRecipients?: string;
};

export interface OutlookSendPreview {
  facetId: string | null;
  /**
   * The facet itself, as render time resolves it (`now_iso` and `timezone`
   * empty): what the chip that carries it adds to the token estimate.
   */
  facet: ActionFacetRequest | undefined;
  draft: OutlookDraftDisposition;
  fingerprint: string;
  /**
   * "scheduling" when sticky scheduling holds the facet slot and ending it
   * would change what the send carries: the scheduling mode chip reads this.
   * Never for the neutral surface's ambient schedule facet, nor on an
   * appointment, where ending changes nothing.
   */
  mode: "scheduling" | null;
  /**
   * What the draft would do once the active selection is dismissed ("Send
   * this instead"); null without an active selection.
   */
  draftWithoutSelection: OutlookDraftDisposition | null;
  /**
   * What the draft would do once sticky scheduling ends; null while it does
   * not hold the facet slot.
   */
  draftWithoutScheduling: OutlookDraftDisposition | null;
}

/**
 * The send resolver run on what render time knows, so the draft chip states
 * what a send would do instead of re-deriving the rules. Render time knows
 * the draft as last read: at bind, on an edit event the host reports, when
 * the pane gains focus, while the draft's detail is open, and at each send,
 * which reads it again before it decides.
 */
export function previewOutlookSend(
  input: OutlookSendPreviewInput,
): OutlookSendPreview {
  const { lastSentDraft, liveRecipients, ...rest } = input;
  const recipients = liveRecipients ?? lastSentDraft?.recipients;
  const fingerprint = outlookDraftFingerprint({ ...rest, recipients });
  const lastSentDraftFingerprint = lastSentDraft?.sent ?? null;
  const facetInput = {
    ...rest,
    recipients,
    lastSentDraftFingerprint,
    nowIso: "",
    timezone: "",
  };
  const result = resolveOutlookActionFacet(facetInput);
  const facetId = result.facet?.id ?? null;
  const withoutScheduling =
    facetId === OUTLOOK_SCHEDULE_FACET_ID && rest.schedulingThreadActive
      ? resolveOutlookActionFacet({
          ...facetInput,
          schedulingThreadActive: false,
        })
      : null;
  const withoutSelection = rest.hasActiveSelection
    ? resolveOutlookActionFacet({ ...facetInput, hasActiveSelection: false })
    : null;
  return {
    facetId,
    facet: result.facet,
    draft: result.draft,
    fingerprint,
    mode:
      withoutScheduling &&
      (withoutScheduling.facet?.id ?? null) !== OUTLOOK_SCHEDULE_FACET_ID
        ? "scheduling"
        : null,
    draftWithoutSelection: withoutSelection?.draft ?? null,
    draftWithoutScheduling: withoutScheduling?.draft ?? null,
  };
}
