import { i18n } from "@lingui/core";
import { beforeAll, describe, expect, it } from "vitest";

import { previewOutlookSend } from "../outlookActionFacet";
import { outlookContextChips } from "../outlookContextChips";
import { planOutlookFiles } from "../outlookSendFiles";

import type { OutlookSendPreview } from "../outlookActionFacet";
import type {
  OutlookAttachmentRow,
  OutlookContextDisplay,
  OutlookContextModels,
} from "../outlookContextChips";
import type {
  OutlookFilePlan,
  OutlookFilePlanInput,
  OutlookFilePlanThreadInput,
} from "../outlookSendFiles";

beforeAll(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

const preview = (
  over: Partial<OutlookSendPreview> = {},
): OutlookSendPreview => ({
  facetId: null,
  draft: "none",
  fingerprint: "",
  mode: null,
  ...over,
});

const threadFile = new File(["x".repeat(1536)], "thread.eml");

const thread = (
  over: Partial<OutlookFilePlanThreadInput> = {},
): OutlookFilePlanThreadInput => ({
  status: "none",
  signIn: null,
  messageCount: 5,
  includedMessageCount: 5,
  file: threadFile,
  partKey: "current-thread:conv-1",
  trimError: false,
  conversationId: "conv-1",
  choice: null,
  sentInChat: false,
  stagedAsDrop: false,
  ...over,
});

const planInput = (
  over: Partial<Omit<OutlookFilePlanInput, "thread" | "attachments">> & {
    thread?: Partial<OutlookFilePlanThreadInput>;
    attachments?: Partial<OutlookFilePlanInput["attachments"]>;
  } = {},
): OutlookFilePlanInput => ({
  freshChat: true,
  drops: [],
  ...over,
  thread: thread(over.thread),
  attachments: {
    mode: "compose",
    items: [],
    loading: false,
    groupOff: false,
    includeOnFollowUpIds: new Set(),
    sentIds: new Set(),
    ...over.attachments,
  },
});

const row = (
  id: string,
  over: Partial<OutlookAttachmentRow> = {},
): OutlookAttachmentRow => ({
  id,
  name: `${id}.pdf`,
  size: 1024 * 240,
  sizeLabel: "240 KB",
  type: "application/pdf",
  ticked: true,
  cloud: false,
  ...over,
});

const display = (
  over: Partial<OutlookContextDisplay> = {},
): OutlookContextDisplay => ({
  freshChat: true,
  itemKind: "message",
  selection: null,
  draft: null,
  thread: {
    subject: "RE: Q4 vendor contract renewal",
    sizeLabel: "1.5 MB",
    stale: false,
    signingIn: false,
  },
  maxSizeFormatted: "25 MB",
  attachments: { mode: "compose", rows: [], groupOff: false },
  drops: [],
  dropProgress: null,
  schedulingUntil: null,
  formatSize: kb,
  ...over,
});

const messageDraft = (
  over: Partial<NonNullable<OutlookContextDisplay["draft"]>> = {},
): NonNullable<OutlookContextDisplay["draft"]> => ({
  kind: "message",
  off: false,
  body: "Dear Anna, thanks for the update.",
  parent: { subject: "Q4 vendor contract", sender: "Anna Weber" },
  recipients: null,
  appointment: null,
  ...over,
});

const chips = (
  sendPreview: OutlookSendPreview,
  plan: OutlookFilePlan,
  shown: OutlookContextDisplay,
) => outlookContextChips(sendPreview, plan, shown);

describe("outlookContextChips", () => {
  describe("the selection", () => {
    const text = `${"a".repeat(70)} and the rest of the passage`;

    it("replaces the draft it is sent instead of", () => {
      const { selection, draft } = chips(
        preview({ facetId: "outlook_rewrite_selection", draft: "selection" }),
        planOutlookFiles(planInput()),
        display({
          selection: { text, dismissed: false },
          draft: messageDraft(),
        }),
      );
      expect(selection).toMatchObject({
        state: "included",
        meta: "Replaces draft",
        removeLabel: "Dismiss selection",
        text,
        lifetime:
          "Leaving it out lasts until the selection changes or you switch mail items.",
      });
      // Cut by code points, in quotation marks.
      expect(selection?.label).toBe(`“${"a".repeat(60)}…”`);
      expect(selection?.notes.map((note) => note.text)).toEqual([
        "Sent instead of your draft, so Erato rewrites only this text.",
      ]);
      expect(draft).toMatchObject({
        state: "superseded",
        meta: "Replaced by selection",
        actions: ["send-instead"],
      });
    });

    it("never claims to replace a draft there is none of", () => {
      const { selection } = chips(
        preview({ facetId: "outlook_rewrite_selection", draft: "none" }),
        planOutlookFiles(planInput()),
        display({ selection: { text: "Hello", dismissed: false } }),
      );
      expect(selection).toMatchObject({
        state: "included",
        meta: "Selected text",
      });
    });

    it("replaces appointment details on an appointment", () => {
      const { selection, draft } = chips(
        preview({
          facetId: "outlook_rewrite_appointment_selection",
          draft: "selection",
        }),
        planOutlookFiles(planInput()),
        display({
          itemKind: "appointment",
          selection: { text: "Room 3", dismissed: false },
          draft: messageDraft({
            kind: "appointment",
            parent: null,
            appointment: {
              subject: "Planning",
              when: "Fri, Oct 23, 10:00 – 11:00 AM",
              whenLong: "Fri, Oct 23, 2026, 10:00 – 11:00 AM",
              location: "",
              attendees: [],
            },
          }),
        }),
      );
      expect(selection?.meta).toBe("Replaces appointment details");
      expect(draft).toMatchObject({
        kind: "outlook.appointment",
        state: "superseded",
        meta: "Replaced by selection",
      });
      expect(draft?.notes[0]?.text).toBe(
        "Your selection is sent instead of your appointment details.",
      );
    });

    it("is suggested once dismissed, and offers to include it", () => {
      const { selection } = chips(
        preview({ facetId: "outlook_review_draft", draft: "sent" }),
        planOutlookFiles(planInput()),
        display({ selection: { text: "Hello", dismissed: true } }),
      );
      expect(selection).toMatchObject({
        state: "suggested",
        restoreLabel: "Include selection",
      });
      expect(selection?.meta).toBeUndefined();
    });

    it("shows nothing the facet does not carry", () => {
      expect(
        chips(
          preview({ facetId: "outlook_review_draft", draft: "sent" }),
          planOutlookFiles(planInput()),
          display({ selection: { text: "Hello", dismissed: false } }),
        ).selection,
      ).toBeNull();
    });
  });

  describe("the draft", () => {
    const draftOf = (
      sendPreview: OutlookSendPreview,
      over: Partial<NonNullable<OutlookContextDisplay["draft"]>> = {},
    ) =>
      chips(
        sendPreview,
        planOutlookFiles(planInput()),
        display({ draft: messageDraft(over) }),
      ).draft;

    it("names the reply it answers and lists what the send carries", () => {
      const draft = draftOf(
        preview({ facetId: "outlook_review_draft", draft: "sent" }),
        { recipients: { to: ["Anna Weber"], cc: [] } },
      );
      expect(draft).toMatchObject({
        kind: "outlook.draft",
        state: "included",
        label: "Your draft",
        spokenLabel: "Draft",
        meta: "Reply to Anna Weber",
        removeLabel: "Don't include draft",
        body: "Dear Anna, thanks for the update.",
        replyNote:
          "The reply context is shown here only. It reaches Erato through your draft and is never sent on its own.",
        lifetime: "Leaving it out lasts until you switch mail items.",
      });
      expect(draft?.fields).toEqual([
        { label: "To", value: "Anna Weber" },
        { label: "Reply to", value: "Q4 vendor contract — Anna Weber" },
      ]);
    });

    it("has no meta for a new message", () => {
      const draft = draftOf(
        preview({ facetId: "outlook_review_draft", draft: "sent" }),
        { parent: null },
      );
      expect(draft?.meta).toBeUndefined();
      expect(draft?.replyNote).toBeUndefined();
    });

    it.each([
      [
        "unchanged",
        "Unchanged, not re-sent",
        [],
        "Erato already has this version from an earlier message, so it is not sent again. It is sent again when you change it.",
      ],
      [
        "scheduling",
        "Not sent while scheduling",
        ["end-scheduling"],
        "Scheduling takes priority, so this message does not carry your draft. End scheduling to send it again.",
      ],
    ] as const)(
      "reads %s as not sent, and says why",
      (state, meta, actions, note) => {
        const draft = draftOf(preview({ draft: state }));
        expect(draft).toMatchObject({ state: "superseded", meta, actions });
        expect(draft?.notes.map((entry) => entry.text)).toEqual([note]);
      },
    );

    it("is suggested while off, whatever the send would do", () => {
      const draft = draftOf(preview({ draft: "sent" }), { off: true });
      expect(draft).toMatchObject({
        state: "suggested",
        restoreLabel: "Include draft",
        actions: [],
      });
    });

    it("shows the appointment's span as meta and its fields in the detail", () => {
      const draft = draftOf(
        preview({ facetId: "outlook_review_appointment", draft: "sent" }),
        {
          kind: "appointment",
          parent: null,
          appointment: {
            subject: "Planning",
            when: "Fri, Oct 23, 10:00 – 11:00 AM",
            whenLong: "Fri, Oct 23, 2026, 10:00 – 11:00 AM",
            location: "Room 3",
            attendees: ["Bob", "ana@example.com"],
          },
        },
      );
      expect(draft).toMatchObject({
        kind: "outlook.appointment",
        state: "included",
        label: "Appointment details",
        spokenLabel: "Appointment details",
        meta: "Fri, Oct 23, 10:00 – 11:00 AM",
        removeLabel: "Don't include appointment details",
      });
      expect(draft?.body).toBeUndefined();
      expect(draft?.fields).toEqual([
        { label: "Subject", value: "Planning" },
        { label: "When", value: "Fri, Oct 23, 2026, 10:00 – 11:00 AM" },
        { label: "Where", value: "Room 3" },
        { label: "Attendees", value: "Bob, ana@example.com" },
      ]);
    });

    it("draws no chip for a draft the send carries nothing of", () => {
      expect(draftOf(preview({ draft: "none" }))).toBeNull();
    });
  });

  describe("the thread", () => {
    const threadOf = (
      over: Parameters<typeof planInput>[0] = {},
      shown: Partial<OutlookContextDisplay> = {},
    ) =>
      chips(
        preview(),
        planOutlookFiles(
          planInput({ ...over, thread: { status: "ready", ...over.thread } }),
        ),
        display(shown),
      ).thread;

    it("is included with its count and its own size against the limit", () => {
      expect(threadOf()).toMatchObject({
        state: "included",
        label: "RE: Q4 vendor contract renewal",
        meta: "5 messages · 1.5 MB of 25 MB",
        removeLabel: "Leave out the email",
        intro:
          "Untick what Erato should not read. Attachments count toward the 25 MB limit.",
        checklist: true,
        lifetime:
          "Leaving the email out lasts until you switch mail items. Including it again restores these ticks.",
      });
      expect(threadOf()?.restoredAnnouncement).toBeUndefined();
    });

    it("counts a partial choice and says the earlier choice is back", () => {
      expect(
        threadOf(
          { thread: { includedMessageCount: 3 } },
          {
            thread: {
              subject: "RE: Q4",
              sizeLabel: "1.2 MB",
              stale: false,
              signingIn: false,
            },
          },
        ),
      ).toMatchObject({
        meta: "3 of 5 messages · 1.2 MB of 25 MB",
        restoredAnnouncement:
          "Email thread included. Your earlier choice is back.",
      });
      expect(
        threadOf({ thread: { messageCount: 1, includedMessageCount: 1 } })
          ?.meta,
      ).toBe("1 message · 1.5 MB of 25 MB");
    });

    it("says Updating… while the file rebuilds", () => {
      expect(
        threadOf(
          {},
          {
            thread: {
              subject: "S",
              sizeLabel: "1.5 MB",
              stale: true,
              signingIn: false,
            },
          },
        )?.meta,
      ).toBe("5 messages · Updating…");
    });

    it("loads, and signs in, with (x) to go without it", () => {
      expect(threadOf({ thread: { status: "loading" } })).toMatchObject({
        state: "loading",
        meta: "Loading email thread…",
        removeLabel: "Leave out the email",
      });
      expect(
        threadOf(
          { thread: { status: "loading" } },
          {
            thread: {
              subject: "S",
              sizeLabel: null,
              stale: false,
              signingIn: true,
            },
          },
        )?.meta,
      ).toBe("Signing in…");
    });

    it("reports a failed load with a retry and a named dismiss", () => {
      const error = threadOf({ thread: { status: "error", file: null } });
      expect(error).toMatchObject({
        state: "error",
        tone: "error",
        meta: "Couldn't load the email thread",
        removeLabel: "Dismiss email thread",
        actions: ["retry"],
        checklist: false,
      });
      expect(error?.notes).toEqual([
        {
          tone: "error",
          title: "Couldn't load the email thread",
          text: "You can still send without this email context.",
        },
      ]);
    });

    it("asks for a sign-in, or for access", () => {
      expect(
        threadOf({ thread: { status: "error", signIn: "sign-in" } }),
      ).toMatchObject({
        state: "attention",
        tone: "warning",
        meta: "Sign in to load email",
        removeLabel: "Leave out the email",
        actions: ["sign-in"],
        signInLabel: "Sign in",
      });
      expect(
        threadOf({ thread: { status: "error", signIn: "consent" } }),
      ).toMatchObject({
        meta: "Allow access to load email",
        signInLabel: "Allow access",
      });
    });

    it("is suggested once left out, and retries first after a failure", () => {
      expect(threadOf({ thread: { choice: "excluded" } })).toMatchObject({
        state: "suggested",
        restoreLabel: "Include the email",
        restore: "include",
        checklist: true,
      });
      expect(
        threadOf({ thread: { choice: "excluded" } })?.meta,
      ).toBeUndefined();
      expect(
        threadOf({ thread: { status: "error", choice: "excluded" } }),
      ).toMatchObject({
        state: "suggested",
        restoreLabel: "Try loading the email again",
        restore: "include-and-retry",
        checklist: false,
      });
    });

    it("is offered, never sent, on a follow-up", () => {
      const followUp = threadOf({ freshChat: false });
      expect(followUp).toMatchObject({
        state: "suggested",
        meta: "Not included on follow-up messages",
        restoreLabel: "Include the email",
      });
      expect(followUp?.notes[0]?.text).toBe(
        "The email is not included right now. Your choices below are kept and come back when you include it.",
      );
    });

    it("offers every message back when none is ticked", () => {
      expect(
        threadOf({ thread: { includedMessageCount: 0, file: null } }),
      ).toMatchObject({
        state: "suggested",
        meta: "Nothing chosen",
        restoreLabel: "Include every message",
        restore: "include-every",
        restoredAnnouncement: "Email thread included.",
      });
    });

    it("says a trim the bytes refuse stops the send", () => {
      expect(
        threadOf({ thread: { trimError: true, file: null } }),
      ).toMatchObject({
        state: "error",
        meta: "Couldn't leave out unticked parts",
        removeLabel: "Dismiss email thread",
        checklist: true,
      });
    });

    it("has no chip while hidden or absent", () => {
      expect(threadOf({ thread: { sentInChat: true } })).toBeNull();
      expect(threadOf({ thread: { stagedAsDrop: true } })).toBeNull();
      expect(threadOf({ thread: { status: "none" } })).toBeNull();
    });
  });

  describe("Office.js attachments", () => {
    const rows = [
      row("contract-v3", { size: 482 * 1024, sizeLabel: "482 KB" }),
      row("pricing"),
    ];
    const attachmentsOf = (
      plan: NonNullable<Parameters<typeof planInput>[0]>,
      shown: Partial<OutlookContextDisplay> = {},
      itemRows: OutlookAttachmentRow[] = rows,
    ) =>
      chips(
        preview(),
        planOutlookFiles(
          planInput({
            ...plan,
            attachments: {
              items: itemRows.map(({ id, cloud, ticked }) => ({
                id,
                cloud,
                ticked,
              })),
              ...plan.attachments,
            },
          }),
        ),
        display({
          ...shown,
          attachments: {
            mode: plan.attachments?.mode ?? "compose",
            rows: itemRows,
            groupOff: plan.attachments?.groupOff ?? false,
          },
        }),
      );

    it("draws one chip each for up to two", () => {
      const { attachments, attachmentsGroup } = attachmentsOf({});
      expect(attachmentsGroup).toBeNull();
      expect(attachments[0]).toMatchObject({
        id: "contract-v3",
        kind: "outlook.draftAttachment",
        state: "included",
        label: "contract-v3.pdf",
        meta: "Draft attachment · 482 KB",
        removeLabel: "Don't include contract-v3.pdf",
        fields: [
          { label: "Type", value: "application/pdf" },
          { label: "Size", value: "482 KB" },
        ],
      });
    });

    it.each([
      [
        "off",
        { items: [{ id: "contract-v3", cloud: false, ticked: false }] },
        {
          state: "suggested",
          restoreLabel: "Include contract-v3.pdf",
          restore: "restore",
        },
      ],
      [
        "a cloud file",
        { items: [{ id: "contract-v3", cloud: true, ticked: true }] },
        {
          state: "error",
          tone: "error",
          meta: "Cloud file · can't be sent",
          removeLabel: "Dismiss contract-v3.pdf",
        },
      ],
      [
        "sent earlier",
        { sentIds: new Set(["contract-v3"]) },
        { state: "superseded", meta: "Sent earlier, not re-sent" },
      ],
    ] as const)("reads %s", (_name, attachments, expected) => {
      expect(
        attachmentsOf({ freshChat: false, attachments: { ...attachments } })
          .attachments[0],
      ).toMatchObject(expected);
    });

    it("offers a follow-up one for the next message, and says a drop keeps it back", () => {
      expect(
        attachmentsOf({ freshChat: false }, { freshChat: false })
          .attachments[0],
      ).toMatchObject({
        state: "suggested",
        meta: "Not included on follow-up messages",
        restore: "follow-up",
      });
      const withDrop = attachmentsOf({
        drops: [{ key: "d", file: null, size: 0, error: false }],
      }).attachments[0];
      expect(withDrop).toMatchObject({
        state: "superseded",
        meta: "Not sent with dropped emails",
      });
      expect(withDrop?.notes[0]?.text).toBe(
        "Your draft's attachments are not sent while dropped emails are attached.",
      );
      const readWithDrop = attachmentsOf({
        thread: { status: "none" },
        attachments: { mode: "read" },
        drops: [{ key: "d", file: null, size: 0, error: false }],
      }).attachments[0];
      expect(readWithDrop?.kind).toBe("outlook.mailAttachment");
      expect(readWithDrop?.notes[0]?.text).toBe(
        "This email's attachments are not sent while dropped emails are attached.",
      );
    });

    it("reads a read email's attachments as the email's", () => {
      expect(
        attachmentsOf({
          thread: { status: "error" },
          attachments: { mode: "read" },
        }).attachments[0]?.meta,
      ).toBe("Email attachment · 482 KB");
    });

    describe("more than two, as a group", () => {
      const three = [
        row("contract-v3", { size: 482 * 1024 }),
        row("pricing", { size: 36 * 1024 }),
        row("redline", { size: 220 * 1024 }),
      ];
      const items = (ticked: Record<string, boolean> = {}) =>
        three.map(({ id }) => ({
          id,
          cloud: false,
          ticked: ticked[id] ?? true,
        }));
      const group = (
        plan: Parameters<typeof planInput>[0] = {},
        rowsOver: OutlookAttachmentRow[] = three,
        shown: Partial<OutlookContextDisplay> = {},
      ) => attachmentsOf(plan, shown, rowsOver).attachmentsGroup;

      it("counts what goes and its size", () => {
        expect(group()).toMatchObject({
          kind: "outlook.draftAttachments",
          state: "included",
          label: "Draft attachments (3)",
          spokenLabel: "Draft attachments",
          meta: "3 of 3 · 738 KB",
          removeLabel: "Don't include draft attachments",
        });
        const partial = three.map((entry) =>
          entry.id === "redline" ? { ...entry, ticked: false } : entry,
        );
        expect(
          group({ attachments: { items: items({ redline: false }) } }, partial)
            ?.meta,
        ).toBe("2 of 3 · 518 KB");
      });

      it("is suggested when off or nothing is ticked, and ticks all back only then", () => {
        expect(group({ attachments: { groupOff: true } })).toMatchObject({
          state: "suggested",
          restoreLabel: "Include draft attachments",
          restore: { tickAll: false, followUpIds: [] },
        });
        const none = three.map((entry) => ({ ...entry, ticked: false }));
        expect(
          group(
            {
              attachments: {
                items: items({
                  "contract-v3": false,
                  pricing: false,
                  redline: false,
                }),
              },
            },
            none,
          ),
        ).toMatchObject({
          state: "suggested",
          meta: "Nothing chosen",
          restore: { tickAll: true, followUpIds: [] },
        });
      });

      it("offers a follow-up for the ticked ones not sent yet", () => {
        expect(
          group(
            {
              freshChat: false,
              attachments: { sentIds: new Set(["pricing"]) },
            },
            three,
            { freshChat: false },
          ),
        ).toMatchObject({
          state: "suggested",
          meta: "Not included on follow-up messages",
          restore: { tickAll: false, followUpIds: ["contract-v3", "redline"] },
        });
        expect(
          group(
            {
              freshChat: false,
              attachments: {
                sentIds: new Set(["contract-v3", "pricing", "redline"]),
              },
            },
            three,
            { freshChat: false },
          ),
        ).toMatchObject({
          state: "superseded",
          meta: "Sent earlier, not re-sent",
        });
      });
    });
  });

  describe("dropped emails", () => {
    const drops = [
      {
        key: "d1",
        subject: "Re: Offsite agenda",
        senderAndDate: "Lena Hoffmann • 10/7/2026",
        kept: 2,
        total: 2,
      },
      { key: "d2", subject: "", senderAndDate: "", kept: 0, total: 0 },
    ];

    it("names the sender, date and kept attachments, and removes by subject", () => {
      const models = chips(
        preview(),
        planOutlookFiles(
          planInput({
            drops: [
              { key: "d1", file: null, size: 0, error: false },
              { key: "d2", file: null, size: 0, error: true },
            ],
          }),
        ),
        display({ drops }),
      );
      expect(models.drops[0]).toMatchObject({
        key: "d1",
        state: "included",
        label: "Re: Offsite agenda",
        meta: "Lena Hoffmann • 10/7/2026 · 2/2 attachments",
        removeLabel: "Remove Re: Offsite agenda",
      });
      expect(models.drops[1]).toMatchObject({
        state: "error",
        tone: "error",
        label: "Email",
        meta: "Couldn't leave out unticked parts",
        removeLabel: "Remove Email",
      });
    });

    it("leaves the attachment count out without attachments", () => {
      const models = chips(
        preview(),
        planOutlookFiles(
          planInput({
            drops: [{ key: "d1", file: null, size: 0, error: false }],
          }),
        ),
        display({ drops: [{ ...drops[0], kept: 0, total: 0 }] }),
      );
      expect(models.drops[0]?.meta).toBe("Lena Hoffmann • 10/7/2026");
      expect(
        chips(
          preview(),
          planOutlookFiles(
            planInput({
              drops: [{ key: "d1", file: null, size: 0, error: false }],
            }),
          ),
          display({ drops: [{ ...drops[0], kept: 0, total: 1 }] }),
        ).drops[0]?.meta,
      ).toBe("Lena Hoffmann • 10/7/2026 · 0/1 attachment");
    });

    it("shows the pipeline's step while emails are read", () => {
      expect(
        chips(
          preview(),
          planOutlookFiles(planInput()),
          display({ dropProgress: "Reading email 1 of 2…" }),
        ).dropProgress,
      ).toEqual({ label: "Reading email 1 of 2…" });
    });
  });

  describe("the scheduling mode", () => {
    it("says until when, and that the draft goes again once it ends", () => {
      const models = chips(
        preview({
          facetId: "outlook_schedule",
          draft: "scheduling",
          mode: "scheduling",
        }),
        planOutlookFiles(planInput()),
        display({ schedulingUntil: "3:40 PM", draft: messageDraft() }),
      );
      expect(models.scheduling).toEqual({
        label: "Scheduling",
        description:
          "Scheduling stays on for an hour after Erato last read your calendar (until 3:40 PM).",
        endLabel: "End scheduling",
        endedAnnouncement: "Scheduling ended. Your draft is sent again.",
      });
      expect(
        chips(
          preview({ facetId: "outlook_schedule", mode: "scheduling" }),
          planOutlookFiles(planInput()),
          display({ schedulingUntil: "3:40 PM" }),
        ).scheduling?.endedAnnouncement,
      ).toBe("Scheduling ended.");
      expect(
        chips(preview(), planOutlookFiles(planInput()), display()).scheduling,
      ).toBeNull();
    });
  });
});

describe("chips and send agree (matrix)", () => {
  type Selection = "none" | "active" | "dismissed";
  type Draft = "available" | "off" | "unchanged" | "none";

  const REVIEW_FACETS = new Set([
    "outlook_review_draft",
    "outlook_review_appointment",
  ]);
  const REWRITE_FACETS = new Set([
    "outlook_rewrite_selection",
    "outlook_rewrite_appointment_selection",
  ]);

  function check(
    models: OutlookContextModels,
    sendPreview: OutlookSendPreview,
    plan: OutlookFilePlan,
    withoutScheduling: OutlookSendPreview | null,
  ) {
    const { draft, selection, thread, attachments, attachmentsGroup } = models;
    if (draft) {
      expect(draft.state === "included").toBe(sendPreview.draft === "sent");
      if (draft.state === "included") {
        expect(REVIEW_FACETS.has(sendPreview.facetId ?? "")).toBe(true);
      }
      if (draft.state !== "suggested") {
        expect(draft.state === "superseded").toBe(
          ["selection", "scheduling", "unchanged"].includes(sendPreview.draft),
        );
      }
    }
    if (selection) {
      expect(selection.state === "included").toBe(
        REWRITE_FACETS.has(sendPreview.facetId ?? ""),
      );
    } else {
      expect(REWRITE_FACETS.has(sendPreview.facetId ?? "")).toBe(false);
    }
    if (thread) {
      expect(thread.state === "included").toBe(plan.uploadThread);
      if (thread.state === "loading") {
        expect(plan.waitingForThread).toBe(true);
      }
    } else {
      expect(plan.uploadThread).toBe(false);
    }
    expect(plan.uploadThread).toBe(plan.thread.kind === "sent");
    for (const attachment of attachments) {
      expect(attachment.state === "included").toBe(
        plan.composeAttachmentIds.includes(attachment.id),
      );
    }
    if (attachmentsGroup) {
      expect(attachmentsGroup.state === "included").toBe(
        plan.composeAttachmentIds.length > 0,
      );
    }
    if (!attachmentsGroup && attachments.length === 0) {
      expect(plan.composeAttachmentIds).toEqual([]);
    }
    expect(models.scheduling !== null).toBe(sendPreview.mode === "scheduling");
    if (withoutScheduling) {
      expect(sendPreview.mode === "scheduling").toBe(
        withoutScheduling.facetId !== sendPreview.facetId,
      );
    }
  }

  it("holds for every compose combination", () => {
    let checked = 0;
    for (const itemKind of ["message", "appointment"] as const)
      for (const selectionState of [
        "none",
        "active",
        "dismissed",
      ] as Selection[])
        for (const draftState of [
          "available",
          "off",
          "unchanged",
          "none",
        ] as Draft[])
          for (const scheduling of [false, true])
            for (const facets of [true, false])
              for (const freshChat of [true, false])
                for (const count of [0, 2, 3])
                  for (const variant of [
                    "plain",
                    "cloud",
                    "dismissed",
                    "sent",
                  ] as const)
                    for (const dropStaged of [false, true]) {
                      const appointment = itemKind === "appointment";
                      const body =
                        draftState === "none" && !appointment ? "" : "Dear Bob";
                      const selectionCarriable =
                        selectionState !== "none" && (!appointment || facets);
                      const hasActiveSelection =
                        selectionCarriable && selectionState === "active";
                      const draftAvailable =
                        (body.length > 0 || appointment) &&
                        (!appointment || facets) &&
                        draftState !== "none";
                      const draftIncluded =
                        draftAvailable && draftState !== "off";
                      const input = {
                        itemKind,
                        hasActiveSelection,
                        selectionData: selectionCarriable ? "Bob" : "",
                        selectionSource: "body" as const,
                        draftContextIncluded: draftIncluded,
                        draftBody: body,
                        draftContextFingerprint: appointment
                          ? "appt"
                          : undefined,
                        isComposeMode: true,
                        composeEmailAvailable: facets,
                        appointmentRewriteAvailable: facets,
                        appointmentContextAvailable: facets,
                        isReadMode: false,
                        replyFromReadAvailable: facets,
                        scheduleFacetAvailable: facets,
                        calendarAvailable: facets,
                        schedulingThreadActive: scheduling,
                        lastSentDraft:
                          draftState === "unchanged"
                            ? appointment
                              ? { sent: "appt", seen: "appt" }
                              : { sent: body, seen: body }
                            : null,
                      };
                      const sendPreview = previewOutlookSend(input);
                      const withoutScheduling = scheduling
                        ? previewOutlookSend({
                            ...input,
                            schedulingThreadActive: false,
                          })
                        : null;
                      const ids = Array.from(
                        { length: appointment ? 0 : count },
                        (_, i) => `a${i}`,
                      );
                      const rows = ids.map((id, index) =>
                        row(id, {
                          cloud: variant === "cloud" && index === 0,
                          ticked: !(variant === "dismissed" && index === 0),
                        }),
                      );
                      const plan = planOutlookFiles(
                        planInput({
                          freshChat,
                          thread: { status: "none" },
                          attachments: {
                            mode: "compose",
                            items: rows.map(({ id, cloud, ticked }) => ({
                              id,
                              cloud,
                              ticked,
                            })),
                            sentIds: new Set(variant === "sent" ? ["a0"] : []),
                          },
                          drops: dropStaged
                            ? [
                                {
                                  key: "d",
                                  file: new File(["d"], "d.eml"),
                                  size: 1,
                                  error: false,
                                },
                              ]
                            : [],
                        }),
                      );
                      const models = outlookContextChips(
                        sendPreview,
                        plan,
                        display({
                          freshChat,
                          itemKind,
                          selection: selectionCarriable
                            ? {
                                text: "Bob",
                                dismissed: selectionState === "dismissed",
                              }
                            : null,
                          draft: draftAvailable
                            ? messageDraft({
                                kind: appointment ? "appointment" : "message",
                                off: draftState === "off",
                                body,
                              })
                            : null,
                          attachments: {
                            mode: "compose",
                            rows,
                            groupOff: false,
                          },
                          schedulingUntil: sendPreview.mode ? "3:40 PM" : null,
                        }),
                      );
                      check(models, sendPreview, plan, withoutScheduling);
                      checked += 1;
                    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("holds for every read combination", () => {
    let checked = 0;
    for (const status of ["none", "loading", "error", "ready"] as const)
      for (const signIn of [null, "sign-in", "consent"] as const)
        for (const choice of [null, "included", "excluded"] as const)
          for (const sentInChat of [false, true])
            for (const ticks of [5, 3, 0])
              for (const trimError of [false, true])
                for (const freshChat of [true, false])
                  for (const stagedAsDrop of [false, true])
                    for (const scheduling of [false, true])
                      for (const count of [0, 2, 3]) {
                        const input = {
                          itemKind: "message" as const,
                          hasActiveSelection: false,
                          selectionData: "",
                          selectionSource: "body" as const,
                          draftContextIncluded: false,
                          draftBody: "",
                          isComposeMode: false,
                          composeEmailAvailable: true,
                          isReadMode: true,
                          replyFromReadAvailable: true,
                          scheduleFacetAvailable: true,
                          calendarAvailable: true,
                          schedulingThreadActive: scheduling,
                          lastSentDraft: null,
                        };
                        const sendPreview = previewOutlookSend(input);
                        const ids = Array.from(
                          { length: count },
                          (_, i) => `a${i}`,
                        );
                        const rows = ids.map((id) => row(id));
                        const plan = planOutlookFiles(
                          planInput({
                            freshChat,
                            thread: {
                              status,
                              signIn: status === "error" ? signIn : null,
                              includedMessageCount: ticks,
                              file: ticks > 0 && !trimError ? threadFile : null,
                              trimError,
                              choice,
                              sentInChat,
                              stagedAsDrop,
                            },
                            attachments: {
                              mode: "read",
                              items: rows.map(({ id, cloud, ticked }) => ({
                                id,
                                cloud,
                                ticked,
                              })),
                            },
                          }),
                        );
                        const models = outlookContextChips(
                          sendPreview,
                          plan,
                          display({
                            freshChat,
                            attachments: {
                              mode: "read",
                              rows,
                              groupOff: false,
                            },
                            schedulingUntil: sendPreview.mode
                              ? "3:40 PM"
                              : null,
                          }),
                        );
                        check(
                          models,
                          sendPreview,
                          plan,
                          scheduling
                            ? previewOutlookSend({
                                ...input,
                                schedulingThreadActive: false,
                              })
                            : null,
                        );
                        if (
                          status === "loading" &&
                          plan.thread.kind === "loading"
                        ) {
                          expect(plan.uploadThread).toBe(false);
                        }
                        checked += 1;
                      }
    expect(checked).toBeGreaterThan(1000);
  });
});
