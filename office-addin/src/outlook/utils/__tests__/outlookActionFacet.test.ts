import { describe, it, expect } from "vitest";

import {
  outlookAppointmentFingerprint,
  outlookDraftFingerprint,
  previewOutlookSend,
  resolveOutlookActionFacet,
  type OutlookActionFacetInput,
  type OutlookSendPreviewInput,
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
      draft: "none",
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
    expect(result.draft).toBe("selection");
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
    expect(result.draft).toBe("none");
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
    expect(result.draft).toBe("none");
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

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
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
    expect(result.draft).toBe("sent");
    expect(result.sentDraftFingerprint).toBe("Dear Bob, ...");
  });

  it("does NOT send review_draft when the draft chip is dismissed (#1 toggle off)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: false,
      draftBody: "Dear Bob, ...",
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
  });

  it("de-dupes: skips review_draft when the body is unchanged since the last send (#4)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "same body",
      lastSentDraftFingerprint: "same body",
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "unchanged",
      sentDraftFingerprint: null,
    });
  });

  it("re-sends review_draft after the draft body changes", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "edited body",
      lastSentDraftFingerprint: "old body",
    });

    expect(result.facet?.id).toBe("outlook_review_draft");
    expect(result.draft).toBe("sent");
    expect(result.sentDraftFingerprint).toBe("edited body");
  });

  it("skips an empty draft body even when included", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      draftContextIncluded: true,
      draftBody: "",
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
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
    expect(result.draft).toBe("sent");
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
    expect(result.draft).toBe("none");
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
    expect(result.draft).toBe("none");
  });

  it("does NOT send compose_email when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isComposeMode: true,
      composeEmailAvailable: false,
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
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
    expect(result.draft).toBe("sent");
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
    expect(result.draft).toBe("none");
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
    expect(result.draft).toBe("none");
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("does NOT send outlook_reply_from_read when the facet is unavailable (avoids a 400)", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: true,
      replyFromReadAvailable: false,
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
  });

  it("does NOT send outlook_reply_from_read outside read mode", () => {
    const result = resolveOutlookActionFacet({
      ...base,
      isReadMode: false,
      replyFromReadAvailable: true,
    });

    expect(result).toEqual({
      facet: undefined,
      draft: "none",
      sentDraftFingerprint: null,
    });
  });

  it("attaches outlook_schedule ambiently in a NEUTRAL context (no item)", () => {
    const result = resolveOutlookActionFacet({ ...base, ...scheduleReady });

    expect(result.facet).toEqual({
      id: "outlook_schedule",
      args: scheduleArgs,
    });
    expect(result.draft).toBe("none");
    expect(result.sentDraftFingerprint).toBeNull();
  });

  it("does NOT attach outlook_schedule ambiently in read or compose contexts", () => {
    // Read mode belongs to reply_from_read (or nothing when unavailable) …
    expect(
      resolveOutlookActionFacet({ ...base, ...scheduleReady, isReadMode: true })
        .facet,
    ).toBeUndefined();
    // … and compose (here: unchanged deduped draft) keeps its email facets.
    const unchanged = resolveOutlookActionFacet({
      ...base,
      ...scheduleReady,
      isComposeMode: true,
      draftContextIncluded: true,
      draftBody: "same body",
      lastSentDraftFingerprint: "same body",
    });
    expect(unchanged.facet).toBeUndefined();
    expect(unchanged.draft).toBe("unchanged");
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
    expect(result.draft).toBe("none");
  });

  it("sticky: outranks review_draft and compose_email but never a selection", () => {
    const sticky = {
      ...base,
      ...scheduleReady,
      schedulingThreadActive: true,
    };

    // Beats review_draft (changed non-empty draft would otherwise win).
    const overDraft = resolveOutlookActionFacet({
      ...sticky,
      isComposeMode: true,
      composeEmailAvailable: true,
      draftContextIncluded: true,
      draftBody: "a changed draft",
    });
    expect(overDraft.facet?.id).toBe("outlook_schedule");
    expect(overDraft.draft).toBe("scheduling");

    // Beats compose_email (empty compose would otherwise win).
    const overCompose = resolveOutlookActionFacet({
      ...sticky,
      isComposeMode: true,
      composeEmailAvailable: true,
      draftBody: "",
    });
    expect(overCompose.facet?.id).toBe("outlook_schedule");
    expect(overCompose.draft).toBe("none");

    const selection = resolveOutlookActionFacet({
      ...sticky,
      hasActiveSelection: true,
      selectionData: "picked text",
    });
    expect(selection.facet?.id).toBe("outlook_rewrite_selection");
    expect(selection.draft).toBe("none");
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
    expect(result.draft).toBe("sent");
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
    expect(result.draft).toBe("none");
  });
});

describe("optional compose recipient context", () => {
  const recipients = JSON.stringify({
    to: [{ displayName: "Mark", emailAddress: "mark@example.com" }],
    cc: [],
    bcc: [],
  });
  const availableFacetArgs = new Map(
    ["outlook_rewrite_selection", "outlook_review_draft", "compose_email"].map(
      (id) => [id, new Set(["recipients"])],
    ),
  );
  const compose = {
    ...base,
    itemKind: "message" as const,
    isComposeMode: true,
    recipients,
    availableFacetArgs,
  };
  it("supplies recipients for empty draft, review, and selection facets", () => {
    for (const input of [
      { ...compose, composeEmailAvailable: true },
      { ...compose, draftContextIncluded: true, draftBody: "Hello" },
      { ...compose, hasActiveSelection: true, selectionData: "Hello" },
    ]) {
      expect(resolveOutlookActionFacet(input).facet?.args?.recipients).toBe(
        recipients,
      );
    }
  });
  it("omits recipients on old servers and custom facets without support", () => {
    for (const args of [
      undefined,
      new Map(),
      new Map([["compose_email", new Set(["body_format"])]]),
    ]) {
      expect(
        resolveOutlookActionFacet({
          ...compose,
          composeEmailAvailable: true,
          availableFacetArgs: args,
        }).facet?.args,
      ).toEqual({ body_format: "text" });
    }
  });
  it("includes recipient edits in draft deduplication", () => {
    const input = {
      ...compose,
      draftContextIncluded: true,
      draftBody: "Hello",
    };
    const first = resolveOutlookActionFacet(input);
    expect(
      resolveOutlookActionFacet({
        ...input,
        lastSentDraftFingerprint: first.sentDraftFingerprint,
      }).facet,
    ).toBeUndefined();
    expect(
      resolveOutlookActionFacet({
        ...input,
        recipients: '{"to":[]}',
        lastSentDraftFingerprint: first.sentDraftFingerprint,
      }).facet?.args?.recipients,
    ).toBe('{"to":[]}');
  });
  it("never includes email recipients on appointment or read facets", () => {
    expect(
      resolveOutlookActionFacet({
        ...compose,
        itemKind: "appointment",
        hasActiveSelection: true,
        appointmentRewriteAvailable: true,
      }).facet?.args?.recipients,
    ).toBeUndefined();
    expect(
      resolveOutlookActionFacet({
        ...compose,
        isComposeMode: false,
        isReadMode: true,
        replyFromReadAvailable: true,
      }).facet?.args?.recipients,
    ).toBeUndefined();
  });
});

describe("previewOutlookSend", () => {
  const {
    lastSentDraftFingerprint: _ignored,
    nowIso,
    timezone,
    ...rest
  } = base;
  const preview: OutlookSendPreviewInput = {
    ...rest,
    itemKind: "message",
    isComposeMode: true,
    lastSentDraft: null,
  };
  const draft = { ...preview, draftContextIncluded: true, draftBody: "Hello" };

  // The chip and the send have to agree, so each row also runs the resolver
  // the send uses and checks the facet it would carry.
  it.each([
    ["sent", draft, "outlook_review_draft"],
    ["unchanged", { ...draft, lastSentDraft: { sent: "Hello" } }, null],
    [
      "scheduling",
      { ...draft, ...scheduleReady, schedulingThreadActive: true },
      "outlook_schedule",
    ],
    [
      "selection",
      { ...draft, hasActiveSelection: true, selectionData: "Hel" },
      "outlook_rewrite_selection",
    ],
    ["none", { ...draft, draftContextIncluded: false }, null],
    [
      "unchanged",
      {
        ...draft,
        hasActiveSelection: true,
        selectionData: "Hel",
        lastSentDraft: { sent: "Hello" },
      },
      "outlook_rewrite_selection",
    ],
    [
      "unchanged",
      {
        ...draft,
        ...scheduleReady,
        schedulingThreadActive: true,
        lastSentDraft: { sent: "Hello" },
      },
      "outlook_schedule",
    ],
  ] as const)("reports %s together with the facet", (state, input, facetId) => {
    const result = previewOutlookSend(input);
    expect(result.draft).toBe(state);
    expect(result.facetId).toBe(facetId);

    const send = resolveOutlookActionFacet({
      ...input,
      lastSentDraftFingerprint: input.lastSentDraft?.sent ?? null,
      nowIso,
      timezone,
    });
    expect(send.facet?.id ?? null).toBe(facetId);
    expect(send.draft).toBe(state);
  });

  it("hands over the facet it resolved, the one the chips estimate", () => {
    const result = previewOutlookSend(draft);
    expect(result.facet).toEqual(
      resolveOutlookActionFacet({
        ...draft,
        lastSentDraftFingerprint: null,
        nowIso: "",
        timezone: "",
      }).facet,
    );
    expect(result.facet?.args?.full_body).toBe("Hello");
    expect(
      previewOutlookSend({ ...draft, draftContextIncluded: false }).facet,
    ).toBeUndefined();
  });

  describe("the scheduling mode", () => {
    const sticky = { ...scheduleReady, schedulingThreadActive: true };

    it("holds the review facet's slot, so ending it sends the draft again", () => {
      const result = previewOutlookSend({ ...draft, ...sticky });
      expect(result.facetId).toBe("outlook_schedule");
      expect(result.mode).toBe("scheduling");
      expect(previewOutlookSend({ ...draft, ...scheduleReady }).facetId).toBe(
        "outlook_review_draft",
      );
    });

    it("holds reply-from-read's slot in read mode", () => {
      const read = {
        ...preview,
        isComposeMode: false,
        isReadMode: true,
        replyFromReadAvailable: true,
      };
      expect(previewOutlookSend({ ...read, ...sticky }).mode).toBe(
        "scheduling",
      );
    });

    it("never shows for the neutral surface's own schedule facet", () => {
      const neutral = { ...preview, itemKind: null, isComposeMode: false };
      const result = previewOutlookSend({ ...neutral, ...sticky });
      expect(result.facetId).toBe("outlook_schedule");
      expect(result.mode).toBeNull();
    });

    it("never shows on an appointment, nor without stickiness", () => {
      expect(
        previewOutlookSend({
          ...draft,
          ...sticky,
          itemKind: "appointment",
          appointmentContextAvailable: true,
        }).mode,
      ).toBeNull();
      expect(
        previewOutlookSend({ ...draft, ...scheduleReady }).mode,
      ).toBeNull();
      expect(previewOutlookSend(draft).mode).toBeNull();
    });

    it("shows where ending it drops the facet altogether", () => {
      const unchanged = {
        ...draft,
        ...sticky,
        lastSentDraft: { sent: "Hello" },
      };
      expect(previewOutlookSend(unchanged).mode).toBe("scheduling");
    });

    it("says what the draft does once scheduling ends", () => {
      expect(
        previewOutlookSend({ ...draft, ...sticky }).draftWithoutScheduling,
      ).toBe("sent");
      expect(
        previewOutlookSend({
          ...draft,
          ...sticky,
          lastSentDraft: { sent: "Hello" },
        }).draftWithoutScheduling,
      ).toBe("unchanged");
      expect(previewOutlookSend(draft).draftWithoutScheduling).toBeNull();
    });
  });

  it("says what the draft does once the selection is dismissed", () => {
    const selected = { ...draft, hasActiveSelection: true, selectionData: "H" };
    expect(previewOutlookSend(selected).draftWithoutSelection).toBe("sent");
    // Sticky scheduling would still hold the draft back.
    expect(
      previewOutlookSend({
        ...selected,
        ...scheduleReady,
        schedulingThreadActive: true,
      }).draftWithoutSelection,
    ).toBe("scheduling");
    expect(
      previewOutlookSend({
        ...selected,
        lastSentDraft: { sent: "Hello" },
      }).draftWithoutSelection,
    ).toBe("unchanged");
    expect(previewOutlookSend(draft).draftWithoutSelection).toBeNull();
  });

  it("re-includes a draft whose body changed since the send", () => {
    expect(
      previewOutlookSend({
        ...draft,
        draftBody: "Hello again",
        lastSentDraft: { sent: "Hello" },
      }).draft,
    ).toBe("sent");
  });

  it("sends a body edited since the last send again, chip and send alike", () => {
    const lastSentDraft = { sent: "Hello" };
    const edited = { ...draft, draftBody: "Hello, and thanks", lastSentDraft };

    const result = previewOutlookSend(edited);
    expect(result.draft).toBe("sent");
    expect(result.fingerprint).toBe("Hello, and thanks");
    const send = resolveOutlookActionFacet({
      ...edited,
      lastSentDraftFingerprint: lastSentDraft.sent,
      nowIso,
      timezone,
    });
    expect(send.draft).toBe("sent");
    expect(send.facet?.args?.full_body).toBe("Hello, and thanks");
    expect(send.sentDraftFingerprint).toBe("Hello, and thanks");
  });

  it("carries the last send's recipients into the fingerprint", () => {
    const recipients = '{"to":["mark@example.com"]}';
    const withRecipients = {
      ...draft,
      availableFacetArgs: new Map([
        ["outlook_review_draft", new Set(["recipients"])],
      ]),
    };
    const sent = outlookDraftFingerprint({ ...withRecipients, recipients });

    const result = previewOutlookSend({
      ...withRecipients,
      lastSentDraft: { sent, recipients },
    });

    expect(result.fingerprint).toBe(sent);
    expect(result.draft).toBe("unchanged");
  });

  it("re-includes the draft once a reported recipient edit changed them", () => {
    const recipients = '{"to":["mark@example.com"]}';
    const edited = '{"to":["mark@example.com","ana@example.com"]}';
    const withRecipients = {
      ...draft,
      availableFacetArgs: new Map([
        ["outlook_review_draft", new Set(["recipients"])],
      ]),
    };
    const sent = outlookDraftFingerprint({ ...withRecipients, recipients });
    const lastSentDraft = { sent, recipients };

    const result = previewOutlookSend({
      ...withRecipients,
      lastSentDraft,
      liveRecipients: edited,
    });
    expect(result.draft).toBe("sent");
    expect(result.facetId).toBe("outlook_review_draft");
    // The send reads the same edited recipients and attaches the draft too.
    expect(
      resolveOutlookActionFacet({
        ...withRecipients,
        recipients: edited,
        lastSentDraftFingerprint: sent,
        nowIso,
        timezone,
      }).facet?.id,
    ).toBe("outlook_review_draft");

    expect(
      previewOutlookSend({
        ...withRecipients,
        lastSentDraft,
        liveRecipients: recipients,
      }).draft,
    ).toBe("unchanged");
  });

  describe("appointments", () => {
    const bindTime = {
      subject: "Planning",
      requiredAttendees: [
        { displayName: "Bob", emailAddress: "bob@example.com" },
      ],
      optionalAttendees: [],
      location: "",
      start: new Date("2026-08-10T08:00:00.000Z"),
      end: new Date("2026-08-10T09:00:00.000Z"),
      bodyText: "Agenda",
      bodyHtml: "<p>Agenda</p>",
    };
    const live = { ...bindTime, location: "Room 3" };
    const appointment = (fields: typeof bindTime) => ({
      ...preview,
      itemKind: "appointment" as const,
      appointmentContextAvailable: true,
      draftContextIncluded: true,
      draftBody: fields.bodyText,
      draftContextFingerprint: outlookAppointmentFingerprint(fields),
    });
    const lastSentDraft = { sent: outlookAppointmentFingerprint(live) };

    it("reads unchanged once render time holds the form the send read", () => {
      expect(
        previewOutlookSend({ ...appointment(live), lastSentDraft }).draft,
      ).toBe("unchanged");
    });

    it("re-includes details that differ from what the send read", () => {
      for (const fields of [bindTime, { ...live, subject: "Planning v2" }]) {
        const result = previewOutlookSend({
          ...appointment(fields),
          lastSentDraft,
        });
        expect(result.draft).toBe("sent");
        expect(result.facetId).toBe("outlook_review_appointment");
      }
    });

    it("is stable and keyed on every field", () => {
      expect(outlookAppointmentFingerprint(bindTime)).toBe(
        outlookAppointmentFingerprint({ ...bindTime }),
      );
      expect(outlookAppointmentFingerprint(bindTime)).not.toBe(
        outlookAppointmentFingerprint(live),
      );
    });

    it("gives the provider's item and a live snapshot one key for equal values", () => {
      // The bind-time item carries every mail field; the snapshot only its own.
      const providerItem = {
        ...bindTime,
        itemKind: "appointment" as const,
        from: null,
        to: [],
        cc: [],
        organizer: null,
        dateTimeCreated: null,
        conversationId: null,
        internetMessageId: null,
        itemId: null,
        isLoadingBody: false,
        isComposeMode: true,
      };
      const snapshot = {
        subject: "Planning",
        organizer: { displayName: "Ana", emailAddress: "ana@example.com" },
        requiredAttendees: [
          { displayName: "Bob", emailAddress: "bob@example.com" },
        ],
        optionalAttendees: [],
        location: "",
        start: new Date("2026-08-10T08:00:00.000Z"),
        end: new Date("2026-08-10T09:00:00.000Z"),
        bodyText: "Agenda",
        bodyHtml: "<p>Agenda</p>",
      };
      expect(outlookAppointmentFingerprint(providerItem)).toBe(
        outlookAppointmentFingerprint(snapshot),
      );
    });
  });
});
