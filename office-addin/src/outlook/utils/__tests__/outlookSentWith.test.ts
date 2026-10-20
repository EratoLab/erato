import { i18n } from "@lingui/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  quotedSelection,
  selectionExcerpt,
} from "../../../core/selection/selectionExcerpt";
import { resolveOutlookActionFacet } from "../outlookActionFacet";
import { outlookContextChips } from "../outlookContextChips";
import { formatAppointmentWhen } from "../outlookContextFormat";
import { planOutlookFiles } from "../outlookSendFiles";
import { outlookSentWithDescriptors } from "../outlookSentWith";

import type {
  OutlookActionFacetInput,
  OutlookSendPreview,
} from "../outlookActionFacet";
import type { OutlookContextDisplay } from "../outlookContextChips";

const base: OutlookActionFacetInput = {
  itemKind: "message",
  hasActiveSelection: false,
  selectionData: "",
  selectionSource: "body",
  draftContextIncluded: true,
  draftBody: "Dear Anna, thanks for the update.",
  lastSentDraftFingerprint: null,
  isComposeMode: true,
  composeEmailAvailable: true,
  isReadMode: false,
  replyFromReadAvailable: true,
  scheduleFacetAvailable: true,
  calendarAvailable: true,
  schedulingThreadActive: false,
  appointmentRewriteAvailable: true,
  appointmentContextAvailable: true,
  availableFacetArgs: new Map([
    ["outlook_review_draft", new Set(["recipients"])],
  ]),
  nowIso: "2026-10-20T09:00:00+02:00",
  timezone: "Europe/Berlin",
};

const sent = (input: Partial<OutlookActionFacetInput>) => {
  const facet = resolveOutlookActionFacet({ ...base, ...input }).facet!;
  return {
    facet,
    chips: outlookSentWithDescriptors[facet.id](facet.args ?? {}),
  };
};

const recipients = (to: string[], cc: string[] = []) =>
  JSON.stringify({
    to: to.map((displayName) => ({
      displayName,
      emailAddress: `${displayName.split(" ")[0].toLowerCase()}@contoso.test`,
    })),
    cc: cc.map((displayName) => ({ displayName, emailAddress: "" })),
  });

/** The composer's chips on the same send, as the add-in builds them. */
const composerChips = (
  input: Partial<OutlookActionFacetInput>,
  shown: Partial<OutlookContextDisplay>,
) => {
  const result = resolveOutlookActionFacet({ ...base, ...input });
  const preview: OutlookSendPreview = {
    facetId: result.facet?.id ?? null,
    facet: result.facet,
    draft: result.draft,
    fingerprint: "",
    mode: null,
    draftWithoutSelection: null,
    draftWithoutScheduling: null,
  };
  const plan = planOutlookFiles({
    freshChat: true,
    drops: [],
    dropsStale: false,
    thread: {
      status: "none",
      signIn: null,
      messageCount: 0,
      includedMessageCount: 0,
      file: null,
      stale: false,
      partKey: null,
      trimError: false,
      conversationId: null,
      choice: null,
      sentInChat: false,
      stagedAsDrop: false,
    },
    attachments: {
      mode: "compose",
      items: [],
      loading: false,
      groupOff: false,
      includeOnFollowUpIds: new Set(),
      sentIds: new Set(),
    },
  });
  return outlookContextChips(preview, plan, {
    freshChat: true,
    itemKind: input.itemKind ?? base.itemKind,
    selection: null,
    draft: null,
    maxSizeFormatted: "25 MB",
    attachments: { mode: "compose", rows: [], groupOff: false },
    drops: [],
    dropProgress: null,
    schedulingUntil: null,
    formatSize: String,
    thread: {
      subject: "",
      sizeLabel: null,
      stale: false,
      signingIn: false,
      includedMessages: 0,
      totalMessages: 0,
    },
    ...shown,
  });
};

const originalZone = process.env.TZ;

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

afterEach(() => {
  process.env.TZ = originalZone;
});

describe("Outlook sent-with descriptors", () => {
  describe("the draft", () => {
    it("names the draft as the composer did, without recipients when none were sent", () => {
      const { chips } = sent({});
      expect(chips).toEqual([
        {
          id: "outlook.draft",
          kind: "outlook.draft",
          icon: "draft",
          label: "Your draft",
          spokenLabel: "Draft",
          quote: "Dear Anna, thanks for the update.",
        },
      ]);
      const composer = composerChips(
        {},
        {
          draft: {
            kind: "message",
            off: false,
            body: base.draftBody,
            parent: null,
            recipients: null,
            appointment: null,
          },
        },
      ).draft!;
      expect(chips![0].kind).toBe(composer.kind);
      expect(chips![0].label).toBe(composer.label);
      expect(chips![0].spokenLabel).toBe(composer.spokenLabel);
    });

    it.each([
      [["Anna Weber"], "To Anna Weber"],
      [["Anna Weber", "Jonas Klein"], "To Anna Weber +1"],
      [
        ["Anna Weber", "Jonas Klein", "Lea Roth", "Max Kurz"],
        "To Anna Weber +3",
      ],
    ])("names the first recipient and how many follow (%j)", (to, meta) => {
      const { chips } = sent({ recipients: recipients(to, ["Cc Person"]) });
      expect(chips![0].meta).toBe(meta);
    });

    it("leaves the meta out for recipients that do not parse", () => {
      expect(sent({ recipients: "{not json" }).chips![0].meta).toBeUndefined();
      expect(
        sent({ recipients: JSON.stringify({ to: [] }) }).chips![0].meta,
      ).toBeUndefined();
    });
  });

  describe("the appointment", () => {
    const appointment = {
      itemKind: "appointment" as const,
      draftBody: "Agenda: contract renewal.",
      appointmentSubject: "Contract review",
      appointmentStart: "2026-10-23T10:00:00+02:00",
      appointmentEnd: "2026-10-23T11:00:00+02:00",
    };

    it("says when, as the composer's chip said it", () => {
      const { chips } = sent(appointment);
      const [chip] = chips!;
      expect(chip).toMatchObject({
        kind: "outlook.appointment",
        icon: "calendar",
        label: "Appointment details",
        spokenLabel: "Appointment details",
        quote: "Agenda: contract renewal.",
      });
      expect(chip.meta).toBe(
        formatAppointmentWhen(
          appointment.appointmentStart,
          appointment.appointmentEnd,
          {
            timeZone: "Europe/Berlin",
          },
        ),
      );
      const composer = composerChips(appointment, {
        itemKind: "appointment",
        draft: {
          kind: "appointment",
          off: false,
          body: appointment.draftBody,
          parent: null,
          recipients: null,
          appointment: {
            subject: appointment.appointmentSubject,
            // What the composer showed on a Berlin machine.
            when: formatAppointmentWhen(
              appointment.appointmentStart,
              appointment.appointmentEnd,
              { timeZone: "Europe/Berlin" },
            ),
            whenLong: "",
            location: "",
            attendees: [],
          },
        },
      }).draft!;
      expect(chip.kind).toBe(composer.kind);
      expect(chip.label).toBe(composer.label);
      expect(chip.meta).toBe(composer.meta);
    });

    it("reads in the zone it was sent from, not the reader's", () => {
      process.env.TZ = "UTC";
      const [chip] = sent(appointment).chips!;
      expect(chip.meta).toMatch(/10:00/);
      expect(chip.meta).toMatch(/11:00/);
      expect(chip.meta).toMatch(/Oct 23/);
    });

    it("says when in the app's language", () => {
      i18n.loadAndActivate({ locale: "de", messages: {} });
      const [chip] = sent(appointment).chips!;
      expect(chip.meta).toMatch(/23\. Okt/);
    });

    it("falls back to the reader's zone for a zone it does not know", () => {
      const facet = sent(appointment).facet;
      const [chip] = outlookSentWithDescriptors[facet.id]({
        ...facet.args,
        timezone: "Mars/Olympus_Mons",
      })!;
      expect(chip.meta).toBe(
        formatAppointmentWhen(
          appointment.appointmentStart,
          appointment.appointmentEnd,
        ),
      );
    });
  });

  describe("the selection", () => {
    it.each([
      ["message" as const, "outlook_rewrite_selection"],
      ["appointment" as const, "outlook_rewrite_appointment_selection"],
    ])("quotes the selected text of a %s", (itemKind, facetId) => {
      const text = "Could you confirm the delivery date by Friday?";
      const { facet, chips } = sent({
        itemKind,
        hasActiveSelection: true,
        selectionData: text,
      });
      expect(facet.id).toBe(facetId);
      expect(chips).toEqual([
        {
          id: "outlook.selection",
          kind: "outlook.selection",
          icon: "selection",
          label: quotedSelection(selectionExcerpt(text)),
          spokenLabel: "Selection",
          meta: "Selected text",
          quote: text,
        },
      ]);
      const composer = composerChips(
        { itemKind, hasActiveSelection: true, selectionData: text },
        { itemKind, selection: { text, dismissed: false } },
      ).selection!;
      expect(chips![0].label).toBe(composer.label);
    });
  });

  it.each([
    [
      "scheduling",
      { itemKind: null, isComposeMode: false, draftContextIncluded: false },
    ],
    [
      "a reply to the open email",
      { isComposeMode: false, isReadMode: true, draftContextIncluded: false },
    ],
    ["an empty compose", { draftBody: "" }],
  ] as const)("shows nothing for %s", (_name, input) => {
    const { facet, chips } = sent(input);
    expect(facet).toBeDefined();
    expect(chips).toBeNull();
  });
});
