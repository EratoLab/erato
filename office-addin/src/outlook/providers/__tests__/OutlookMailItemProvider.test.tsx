import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../../test/helpers/asyncResult";
import {
  installMockMailbox,
  installMultiSelectSupport,
  uninstallMockMailbox,
  uninstallMultiSelectSupport,
} from "../../../test/mocks/outlook/mailbox";
import {
  OutlookMailItemProvider,
  useOutlookMailItem,
} from "../OutlookMailItemProvider";

type Mailbox = ReturnType<typeof installMockMailbox>;
type ContextValue = ReturnType<typeof useOutlookMailItem>;

function makeReadItem(overrides: Record<string, unknown> = {}) {
  return {
    // `isMessageRead` keys on `typeof subject === "string"`.
    subject: "Quarterly report",
    from: { displayName: "Ana", emailAddress: "ana@x" },
    to: [],
    cc: [],
    dateTimeCreated: new Date("2026-01-01T00:00:00Z"),
    conversationId: "conv-read",
    internetMessageId: "<read-1@x>",
    itemId: "item-1",
    attachments: [],
    body: {
      getAsync: (_coercion: unknown, cb: (r: unknown) => void) =>
        cb(createMockAsyncResult("")),
    },
    ...overrides,
  };
}

function makeComposeItem(overrides: Record<string, unknown> = {}) {
  const asyncField = (value: unknown) => ({
    getAsync: (cb: (r: unknown) => void) => cb(createMockAsyncResult(value)),
  });
  return {
    // Compose items have an async subject (`isMessageRead` keys on string).
    subject: asyncField(""),
    to: asyncField([]),
    cc: asyncField([]),
    // Null until the draft is first saved.
    conversationId: null,
    body: {
      getAsync: (_coercion: unknown, cb: (r: unknown) => void) =>
        cb(createMockAsyncResult("")),
    },
    getAttachmentsAsync: (cb: (r: unknown) => void) =>
      cb(createMockAsyncResult([])),
    ...overrides,
  };
}

function makeAppointmentCompose(overrides: Record<string, unknown> = {}) {
  const asyncField = (value: unknown) => ({
    getAsync: (cb: (r: unknown) => void) => cb(createMockAsyncResult(value)),
  });
  return {
    itemType: "appointment",
    seriesId: null,
    subject: asyncField("Planning session"),
    organizer: asyncField({
      displayName: "Ana",
      emailAddress: "ana@x",
    }),
    requiredAttendees: asyncField([
      { displayName: "Bob", emailAddress: "bob@x" },
    ]),
    optionalAttendees: asyncField([]),
    location: asyncField("Room 3"),
    start: asyncField(new Date("2026-08-10T08:00:00Z")),
    end: asyncField(new Date("2026-08-10T09:00:00Z")),
    body: {
      getAsync: (coercion: Office.CoercionType, cb: (r: unknown) => void) =>
        cb(
          createMockAsyncResult(
            coercion === Office.CoercionType.Html
              ? "<p>Discuss roadmap</p>"
              : "Discuss roadmap",
          ),
        ),
    },
    getAttachmentsAsync: (cb: (r: unknown) => void) =>
      cb(createMockAsyncResult([])),
    ...overrides,
  };
}

function makeSelectedItem(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: "conv-thread",
    itemId: "sel-1",
    itemMode: "read",
    itemType: "message",
    subject: "Quarterly report",
    ...overrides,
  };
}

let mailbox: Mailbox;
let captured: ContextValue | null;

function Capture() {
  captured = useOutlookMailItem();
  return null;
}

async function renderProvider() {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <OutlookMailItemProvider>
        <Capture />
      </OutlookMailItemProvider>,
    );
  });
  return result;
}

beforeEach(() => {
  mailbox = installMockMailbox();
  captured = null;
});

afterEach(() => {
  cleanup();
  uninstallMockMailbox();
  vi.clearAllMocks();
});

describe("OutlookMailItemProvider", () => {
  it("exposes the current read item", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();
    expect(captured?.mailItem?.internetMessageId).toBe("<read-1@x>");
    expect(captured?.mailItem?.isComposeMode).toBe(false);
  });

  it("clears the item when the mailbox has none", async () => {
    mailbox.item = null;
    await renderProvider();
    expect(captured?.mailItem).toBeNull();
  });

  it("treats an appointment attendee/read item as no item", async () => {
    mailbox.item = makeReadItem({ itemType: "appointment" });
    await renderProvider();
    expect(captured?.mailItem).toBeNull();
    expect(captured?.itemIdentity).toBeNull();
  });

  it("loads organizer appointment fields and description", async () => {
    mailbox.item = makeAppointmentCompose();
    await renderProvider();

    expect(captured?.mailItem).toMatchObject({
      itemKind: "appointment",
      subject: "Planning session",
      organizer: { displayName: "Ana", emailAddress: "ana@x" },
      requiredAttendees: [{ displayName: "Bob", emailAddress: "bob@x" }],
      optionalAttendees: [],
      location: "Room 3",
      bodyText: "Discuss roadmap",
      bodyHtml: "<p>Discuss roadmap</p>",
      isLoadingBody: false,
      isComposeMode: true,
    });
    expect(captured?.itemIdentity).toMatch(/^appointment:/);
  });

  it("never reads appointment attachments (isolation from email context)", async () => {
    const getAttachmentsAsync = vi.fn((cb: (r: unknown) => void) =>
      cb(createMockAsyncResult([{ id: "a1", name: "agenda.pdf" }])),
    );
    mailbox.item = makeAppointmentCompose({ getAttachmentsAsync });
    await renderProvider();

    expect(getAttachmentsAsync).not.toHaveBeenCalled();
    expect(captured?.attachments).toEqual([]);
    expect(captured?.isLoadingAttachments).toBe(false);
  });

  it("keeps the same per-window identity for an unsaved appointment", async () => {
    mailbox.item = makeAppointmentCompose();
    await renderProvider();
    const firstIdentity = captured?.itemIdentity;

    const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
    await act(async () => {
      handler();
    });

    expect(captured?.itemIdentity).toBe(firstIdentity);
    expect(captured?.hasItemChangedFired).toBe(false);
  });

  // Drives the "pin this add-in" hint: stays false on the host's initial
  // same-item selection event (which would otherwise flash-and-clear the hint),
  // and only flips true on a real navigation to a different item.
  it("flags hasItemChangedFired only when the selected item actually changes", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();
    expect(captured?.hasItemChangedFired).toBe(false);

    const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;

    // Initial-bind / same-item event — must NOT flip it.
    await act(async () => {
      handler();
    });
    expect(captured?.hasItemChangedFired).toBe(false);

    // Real navigation to a different message — flips it true.
    mailbox.item = makeReadItem({ internetMessageId: "<read-2@x>" });
    await act(async () => {
      handler();
    });
    expect(captured?.hasItemChangedFired).toBe(true);
  });

  // Unsaved drafts get a freshly minted identity on every resolve, so a
  // same-draft re-resolve (e.g. the host's initial-bind event) must not count
  // as a navigation.
  it("does not flag hasItemChangedFired for a same-draft compose re-resolve", async () => {
    mailbox.item = makeComposeItem();
    await renderProvider();
    expect(captured?.mailItem?.isComposeMode).toBe(true);
    expect(captured?.hasItemChangedFired).toBe(false);

    const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
    await act(async () => {
      handler();
    });
    expect(captured?.hasItemChangedFired).toBe(false);
  });

  // A → no selection → B is a real navigation (only a tracking pane sees the
  // null-item event at all) and must still flip the flag.
  it("flags hasItemChangedFired across a null-selection gap", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();

    const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;

    mailbox.item = null;
    await act(async () => {
      handler();
    });
    expect(captured?.hasItemChangedFired).toBe(false);

    mailbox.item = makeReadItem({ internetMessageId: "<read-2@x>" });
    await act(async () => {
      handler();
    });
    expect(captured?.hasItemChangedFired).toBe(true);
  });

  // Mailbox.removeHandlerAsync removes ALL handlers for the event type; its
  // optional second arg is a completion callback that Office invokes — the
  // registered handler must never be passed there.
  it("unsubscribes without passing the handler as a callback", async () => {
    mailbox.item = makeReadItem();
    const { unmount } = await renderProvider();

    act(() => {
      unmount();
    });

    expect(mailbox.removeHandlerAsync).toHaveBeenCalled();
    for (const call of mailbox.removeHandlerAsync.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  // Clicking a collapsed conversation header on OWA / new Outlook selects every
  // message in the stack, so the host reports no `mailbox.item` at all even
  // though a thread is genuinely selected — the live selection is the only
  // place that context still exists.
  describe("selection probe", () => {
    function answerWithSelection(details: unknown[]) {
      mailbox.getSelectedItemsAsync.mockImplementation((callback) =>
        callback(createMockAsyncResult(details)),
      );
    }

    beforeEach(() => {
      // The capability guard is read inside the read effect, so the host shape
      // has to be in place before the first render.
      installMultiSelectSupport();
    });

    afterEach(() => {
      uninstallMultiSelectSupport();
    });

    it("summarises the selected conversation when the host reports no item", async () => {
      mailbox.item = null;
      answerWithSelection([
        makeSelectedItem(),
        makeSelectedItem({ itemId: "sel-2" }),
      ]);

      await renderProvider();

      expect(captured?.selectedConversation).toEqual({
        conversationId: "conv-thread",
        itemId: "sel-1",
        messageCount: 2,
      });
      // A conversation names no single message, so nothing may stand in for
      // one: item-bound executors (reply) have to keep failing closed.
      expect(captured?.mailItem).toBeNull();
      expect(captured?.itemIdentity).toBeNull();
    });

    // Exchange SE regression lock: SE caps at Mailbox 1.5, far below what the
    // probe needs, and the shared Office stub models it by leaving
    // `context.requirements` undefined. A capability question the host cannot
    // answer at all must count as unsupported — no Office call may be issued.
    it("issues no probe on a host that reports no requirement sets", async () => {
      uninstallMultiSelectSupport();
      mailbox.item = null;
      answerWithSelection([makeSelectedItem()]);

      await renderProvider();

      expect(mailbox.getSelectedItemsAsync).not.toHaveBeenCalled();
      expect(captured?.selectedConversation).toBeNull();
    });

    // `getSelectedItemsAsync` itself is Mailbox 1.13, but the only field the
    // probe consumes — `SelectedItemDetails.conversationId` — is 1.14, so a
    // 1.13 host would answer with entries that summarise to nothing. The
    // shared helper reports every set as supported, hence the local stub.
    it("does not probe a host that stops short of Mailbox 1.14", async () => {
      // Answers "supported" for everything except the set the probe requires.
      (Office.context as unknown as Record<string, unknown>).requirements = {
        isSetSupported: (set: string, version: string) =>
          !(set === "Mailbox" && version === "1.14"),
      };
      mailbox.item = null;
      answerWithSelection([makeSelectedItem()]);

      await renderProvider();

      expect(mailbox.getSelectedItemsAsync).not.toHaveBeenCalled();
      expect(captured?.selectedConversation).toBeNull();
    });

    it("clears the conversation when a later probe fails", async () => {
      mailbox.item = null;
      answerWithSelection([makeSelectedItem()]);
      await renderProvider();
      expect(captured?.selectedConversation).not.toBeNull();

      // Nothing pre-clears on the probe path — that would blink the pane on
      // every header click — so a failed answer has to commit the null itself
      // or the previous thread stays mounted for good.
      mailbox.getSelectedItemsAsync.mockImplementation((callback) =>
        callback(
          createMockAsyncResult([], "failed", {
            message: "The operation failed.",
            code: "5001",
          }),
        ),
      );
      const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
      await act(async () => {
        handler();
      });

      expect(captured?.selectedConversation).toBeNull();
      expect(captured?.mailItem).toBeNull();
    });

    // Pins the raw-item gate: an appointment in read/attendee mode narrows to
    // "no supported item", but the host does have an item open — probing there
    // would mount a mail conversation while a calendar item is on screen.
    it("never probes while an appointment read item is open", async () => {
      mailbox.item = makeReadItem({ itemType: "appointment" });
      answerWithSelection([makeSelectedItem()]);

      await renderProvider();

      expect(mailbox.getSelectedItemsAsync).not.toHaveBeenCalled();
      expect(captured?.selectedConversation).toBeNull();
      expect(captured?.mailItem).toBeNull();
    });

    it("clears the conversation once a real item is selected", async () => {
      mailbox.item = null;
      answerWithSelection([makeSelectedItem()]);
      await renderProvider();
      expect(captured?.selectedConversation).not.toBeNull();

      const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
      mailbox.item = makeReadItem();
      await act(async () => {
        handler();
      });

      expect(captured?.selectedConversation).toBeNull();
      expect(captured?.mailItem?.internetMessageId).toBe("<read-1@x>");
    });

    // The probe outlives the selection that started it: a host can answer after
    // the user has already opened a message, and that late answer must lose.
    it("discards a probe answer that lands after a real item is selected", async () => {
      mailbox.item = null;
      // Hold the probe open — the mock never answers on its own.
      mailbox.getSelectedItemsAsync.mockImplementation(() => {});
      await renderProvider();

      const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
      mailbox.item = makeReadItem();
      await act(async () => {
        handler();
      });

      const answerProbe = mailbox.getSelectedItemsAsync.mock.calls[0][0];
      await act(async () => {
        answerProbe(createMockAsyncResult([makeSelectedItem()]));
      });

      expect(captured?.selectedConversation).toBeNull();
      expect(captured?.mailItem?.internetMessageId).toBe("<read-1@x>");
    });

    // Deliberate trade-off, pinned here because every FINAL state is identical
    // either way and only the intermediate frame differs: header → header keeps
    // the previous conversation staged until the host answers, rather than
    // blanking the pane on every header click. Bounded by the probe round-trip
    // (SELECTED_ITEMS_TIMEOUT_MS worst case) — a late answer from the earlier
    // probe still loses, per the test above.
    it("keeps the previous conversation staged while the next probe is in flight", async () => {
      mailbox.item = null;
      answerWithSelection([makeSelectedItem()]);
      await renderProvider();
      expect(captured?.selectedConversation?.conversationId).toBe(
        "conv-thread",
      );

      // Hold the second probe open: the host reports no item for a header
      // click, so the effect re-enters the same branch with nothing to swap in.
      mailbox.getSelectedItemsAsync.mockImplementation(() => {});
      const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
      await act(async () => {
        handler();
      });

      expect(captured?.selectedConversation?.conversationId).toBe(
        "conv-thread",
      );
    });
  });
});
