import { describe, it, expect } from "vitest";

import {
  resolveOutlookActionFacet,
  type OutlookActionFacetInput,
} from "../outlookActionFacet";

const base: OutlookActionFacetInput = {
  itemKind: null,
  hasActiveSelection: false,
  selectionData: "",
  selectionSource: "body",
  draftContextIncluded: false,
  draftBody: "",
  lastSentDraftFingerprint: null,
  bodyFormat: undefined,
  isComposeMode: false,
  composeEmailAvailable: false,
  isReadMode: false,
  replyFromReadAvailable: false,
  scheduleFacetAvailable: false,
  calendarAvailable: false,
  schedulingThreadActive: false,
  nowIso: "2026-07-03T14:00:00+02:00",
  timezone: "Europe/Berlin",
};

/** Scheduling feature fully available (facet advertised + calendar backend). */
const scheduleReady = {
  scheduleFacetAvailable: true,
  calendarAvailable: true,
} as const;

const scheduleArgs = {
  now_iso: "2026-07-03T14:00:00+02:00",
  timezone: "Europe/Berlin",
};

describe("resolveOutlookActionFacet", () => {
  it("returns no facet with nothing selected and no draft included", () => {
    expect(resolveOutlookActionFacet(base)).toEqual({
      facet: undefined,
      sentDraftFingerprint: null,
    });
  });

  it("sends rewrite_selection when a selection is active — and it wins over the draft", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      hasActiveSelection: true,
      selectionData: "hello",
      selectionSource: "body",
      // A draft is also present, but the selection takes priority.
      draftContextIncluded: true,
      draftBody: "a whole draft",
      bodyFormat: "html",
    });

    expect(result.facet).toEqual({
      id: "outlook_rewrite_selection",
      args: {
        selected_text: "hello",
        source_property: "body",
        body_format: "html",
      },
    });
    // Selection sends never touch the draft dedup marker.
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("omits body_format from rewrite args when the format is unknown", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      hasActiveSelection: true,
      selectionData: "x",
      selectionSource: "subject",
    });

    expect(result.facet?.args).toEqual({
      selected_text: "x",
      source_property: "subject",
    });
  });

  it("uses the appointment-specific rewrite facet for organizer selections", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "appointment",
      isComposeMode: true,
      appointmentRewriteAvailable: true,
      hasActiveSelection: true,
      selectionData: "Old agenda",
      selectionSource: "body",
      bodyFormat: "html",
    });

    expect(result.facet).toEqual({
      id: "outlook_rewrite_appointment_selection",
      args: {
        selected_text: "Old agenda",
        source_property: "body",
        body_format: "html",
      },
    });
  });

  it("does not send an appointment selection to the email rewrite facet", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "appointment",
      isComposeMode: true,
      appointmentRewriteAvailable: false,
      hasActiveSelection: true,
      selectionData: "Old agenda",
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("sends review_draft for an included, non-empty, changed draft", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "Dear Bob, ...",
      lastSentDraftFingerprint: null,
    });

    expect(result.facet).toEqual({
      id: "outlook_review_draft",
      args: { full_body: "Dear Bob, ...", body_format: "text" },
    });
    expect(result.sentDraftFingerprint).toBe("Dear Bob, ...");
  });

  it("does NOT send review_draft when the draft chip is dismissed (#1 toggle off)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: false,
      draftBody: "Dear Bob, ...",
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("de-dupes: skips review_draft when the body is unchanged since the last send (#4)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "same body",
      lastSentDraftFingerprint: "same body",
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("re-sends review_draft after the draft body changes", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "edited body",
      lastSentDraftFingerprint: "old body",
    });

    expect(result.facet?.id).toBe("outlook_review_draft");
    expect(result.sentDraftFingerprint).toBe("edited body");
  });

  it("skips an empty draft body even when included", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "",
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("sends explicit appointment context, including an empty description", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "appointment",
      isComposeMode: true,
      appointmentContextAvailable: true,
      draftContextIncluded: true,
      draftBody: "",
      draftContextFingerprint: "appointment-v1",
      appointmentSubject: "Planning session",
      appointmentRequiredAttendees: "bob@example.com",
      appointmentOptionalAttendees: "ana@example.com",
      appointmentLocation: "Room 3",
      appointmentStart: "2026-08-10T08:00:00.000Z",
      appointmentEnd: "2026-08-10T09:00:00.000Z",
    });

    expect(result.facet).toEqual({
      id: "outlook_review_appointment",
      args: {
        subject: "Planning session",
        full_body: "",
        required_attendees: "bob@example.com",
        optional_attendees: "ana@example.com",
        location: "Room 3",
        start: "2026-08-10T08:00:00.000Z",
        end: "2026-08-10T09:00:00.000Z",
        body_format: "text",
        timezone: "Europe/Berlin",
      },
    });
    expect(result.sentDraftFingerprint).toBe("appointment-v1");
  });

  it("never falls through to email-only compose or reply facets for appointments", () => {
    expect(
      resolveOutlookActionFacet({
        ...base,
        itemKind: "appointment",
        isComposeMode: true,
        composeEmailAvailable: true,
      }).facet,
    ).toBeUndefined();
    expect(
      resolveOutlookActionFacet({
        ...base,
        itemKind: "appointment",
        isReadMode: true,
        replyFromReadAvailable: true,
      }).facet,
    ).toBeUndefined();
  });

  it("sends compose_email for an empty compose draft when the facet is available", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "message",
      isComposeMode: true,
      draftBody: "   ",
      bodyFormat: "html",
      composeEmailAvailable: true,
    });

    expect(result.facet?.id).toBe("compose_email");
    expect(result.facet?.args).toEqual({ body_format: "html" });
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("defaults compose_email body_format to text when unknown", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "message",
      isComposeMode: true,
      composeEmailAvailable: true,
    });

    expect(result.facet?.args).toEqual({ body_format: "text" });
  });

  it("does NOT send compose_email when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: false,
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("prefers review_draft over compose_email once the draft has content", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: true,
      draftContextIncluded: true,
      draftBody: "an existing draft",
    });

    expect(result.facet?.id).toBe("outlook_review_draft");
  });

  it("prefers a selection over compose_email", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: true,
      hasActiveSelection: true,
      selectionData: "picked text",
    });

    expect(result.facet?.id).toBe("outlook_rewrite_selection");
  });

  it("sends outlook_reply_from_read in read mode when the facet is available", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "message",
      isReadMode: true,
      replyFromReadAvailable: true,
    });

    expect(result.facet).toEqual({
      id: "outlook_reply_from_read",
      args: { body_format: "html" },
    });
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("does NOT send outlook_reply_from_read when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: true,
      replyFromReadAvailable: false,
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("does NOT send outlook_reply_from_read outside read mode", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: false,
      replyFromReadAvailable: true,
    });

    expect(result).toEqual({ facet: undefined, sentDraftFingerprint: null });
  });

  it("attaches outlook_schedule ambiently in a NEUTRAL context (no item)", () => {
    const result = resolveOutlookActionFacet({ ...base, ...scheduleReady });

    expect(result.facet).toEqual({
      id: "outlook_schedule",
      args: scheduleArgs,
    });
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("does NOT attach outlook_schedule ambiently in read or compose contexts", () => {
    // Read mode belongs to reply_from_read (or nothing when unavailable) …
    expect(
      resolveOutlookActionFacet({ ...base, ...scheduleReady, isReadMode: true })
        .facet,
    ).toBeUndefined();
    // … and compose (here: unchanged deduped draft) keeps its email facets.
    expect(
      resolveOutlookActionFacet({
        ...base,
        ...scheduleReady,
        isComposeMode: true,
        draftContextIncluded: true,
        draftBody: "same body",
        lastSentDraftFingerprint: "same body",
      }).facet,
    ).toBeUndefined();
  });

  it("gates outlook_schedule on facet availability AND a calendar backend", () => {
    expect(
      resolveOutlookActionFacet({ ...base, scheduleFacetAvailable: true })
        .facet,
    ).toBeUndefined();
    expect(
      resolveOutlookActionFacet({ ...base, calendarAvailable: true }).facet,
    ).toBeUndefined();
  });

  it("sticky: an in-flight scheduling exchange claims the slot over reply_from_read", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      ...scheduleReady,
      schedulingThreadActive: true,
      isReadMode: true,
      replyFromReadAvailable: true,
    });

    expect(result.facet).toEqual({
      id: "outlook_schedule",
      args: scheduleArgs,
    });
  });

  it("sticky: outranks review_draft and compose_email but never a selection", () => {
    const sticky = {
      ...base,
      ...scheduleReady,
      schedulingThreadActive: true,
    };

    // Beats review_draft (changed non-empty draft would otherwise win).
    expect(
      resolveOutlookActionFacet({
        ...sticky,
        isComposeMode: true,
        composeEmailAvailable: true,
        draftContextIncluded: true,
        draftBody: "a changed draft",
      }).facet?.id,
    ).toBe("outlook_schedule");

    // Beats compose_email (empty compose would otherwise win).
    expect(
      resolveOutlookActionFacet({
        ...sticky,
        isComposeMode: true,
        composeEmailAvailable: true,
        draftBody: "",
      }).facet?.id,
    ).toBe("outlook_schedule");

    expect(
      resolveOutlookActionFacet({
        ...sticky,
        hasActiveSelection: true,
        selectionData: "picked text",
      }).facet?.id,
    ).toBe("outlook_rewrite_selection");
  });

  it("sticky never claims an appointment compose — the review facet owns it", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      ...scheduleReady,
      schedulingThreadActive: true,
      itemKind: "appointment",
      isComposeMode: true,
      appointmentContextAvailable: true,
      draftContextIncluded: true,
      draftContextFingerprint: "appointment-v1",
    });

    expect(result.facet?.id).toBe("outlook_review_appointment");
  });

  it("sticky does not fire without an available facet or calendar backend", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      itemKind: "message",
      schedulingThreadActive: true,
      scheduleFacetAvailable: true,
      calendarAvailable: false,
      isReadMode: true,
      replyFromReadAvailable: true,
    });

    // Falls through to the normal read-mode rung.
    expect(result.facet?.id).toBe("outlook_reply_from_read");
  });
});
