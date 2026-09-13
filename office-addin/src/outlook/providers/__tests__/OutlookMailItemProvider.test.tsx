import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../../test/helpers/asyncResult";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import {
  OutlookMailItemProvider,
  useOutlookMailItem,
} from "../OutlookMailItemProvider";

type Mailbox = ReturnType<typeof installMockMailbox>;
type ContextValue = ReturnType<typeof useOutlookMailItem>;
// `delegatePermissions` is a host enum the Office mock does not carry, so the
// mocked result stays loosely typed rather than reconstructing it.
type SharedPropertiesCallback = (result: Office.AsyncResult<unknown>) => void;

function sharedProperties(overrides: Record<string, unknown> = {}) {
  return {
    owner: "team@x",
    targetRestUrl: "https://outlook.office.com/api",
    targetMailbox: "team@x",
    delegatePermissions: 3,
    ...overrides,
  };
}

function sharedPropertiesSucceeded(overrides: Record<string, unknown> = {}) {
  return (cb: SharedPropertiesCallback) =>
    cb(createMockAsyncResult(sharedProperties(overrides)));
}

// Outlook reports "not a shared folder or mailbox" by failing the callback.
function sharedPropertiesFailed() {
  return (cb: SharedPropertiesCallback) =>
    cb(createMockAsyncResult(undefined, "failed"));
}

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

  // Hosts that predate Mailbox 1.8 expose no method at all; the provider must
  // settle to "not shared" rather than sit loading forever.
  it("reports no shared context when the host lacks the API", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();

    expect(captured?.sharedContext).toBeNull();
    expect(captured?.isLoadingSharedContext).toBe(false);
  });

  // A failed callback is the documented "not shared" answer, so it must stay
  // silent — a warning here would fire on every ordinary message.
  it("treats a failed shared-properties callback as not shared, silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mailbox.item = makeReadItem({
      getSharedPropertiesAsync: sharedPropertiesFailed(),
    });
    await renderProvider();

    expect(captured?.sharedContext).toBeNull();
    expect(captured?.isLoadingSharedContext).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("exposes the shared context of an item in a shared mailbox", async () => {
    mailbox.item = makeReadItem({
      getSharedPropertiesAsync: sharedPropertiesSucceeded(),
    });
    await renderProvider();

    expect(captured?.sharedContext).toEqual({
      owner: "team@x",
      targetMailbox: "team@x",
      delegatePermissions: 3,
    });
    expect(captured?.isLoadingSharedContext).toBe(false);
  });

  // Appointment compose serves the API too — the shared read sits above the
  // early-return that keeps appointment attachments out of email context.
  it("reads the shared context of an appointment compose without touching its attachments", async () => {
    const getAttachmentsAsync = vi.fn((cb: (r: unknown) => void) =>
      cb(createMockAsyncResult([{ id: "a1", name: "agenda.pdf" }])),
    );
    mailbox.item = makeAppointmentCompose({
      getAttachmentsAsync,
      getSharedPropertiesAsync: sharedPropertiesSucceeded({
        owner: "boss@x",
        targetMailbox: null,
      }),
    });
    await renderProvider();

    expect(captured?.sharedContext).toEqual({
      owner: "boss@x",
      targetMailbox: null,
      delegatePermissions: 3,
    });
    expect(getAttachmentsAsync).not.toHaveBeenCalled();
    expect(captured?.attachments).toEqual([]);
  });

  // A pinned pane navigating A → B while A's call is still in flight: the late
  // answer belongs to an item that is no longer selected.
  it("discards a shared-context result that lands after navigating away", async () => {
    let respondForA: SharedPropertiesCallback | undefined;
    mailbox.item = makeReadItem({
      getSharedPropertiesAsync: (cb: SharedPropertiesCallback) => {
        respondForA = cb;
      },
    });
    await renderProvider();
    expect(captured?.sharedContext).toBeNull();

    const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
    mailbox.item = makeReadItem({
      internetMessageId: "<read-2@x>",
      getSharedPropertiesAsync: sharedPropertiesSucceeded({ owner: "b@x" }),
    });
    await act(async () => {
      handler();
    });
    expect(captured?.sharedContext?.owner).toBe("b@x");

    await act(async () => {
      respondForA?.(createMockAsyncResult(sharedProperties({ owner: "a@x" })));
    });

    expect(captured?.sharedContext?.owner).toBe("b@x");
    expect(captured?.isLoadingSharedContext).toBe(false);
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

  it.each(["", "   "])(
    "normalises a blank targetMailbox (%j) to null so the owner fallback applies",
    async (targetMailbox) => {
      mailbox.item = makeReadItem({
        getSharedPropertiesAsync: sharedPropertiesSucceeded({ targetMailbox }),
      });
      await renderProvider();

      // Consumers fall back with `targetMailbox ?? owner`; an empty string
      // would win that `??`, read as "not shared", and route the item to the
      // user's own store — silently, with the narrow Graph scope.
      expect(captured?.sharedContext).toEqual({
        owner: "team@x",
        targetMailbox: null,
        delegatePermissions: 3,
      });
    },
  );

  it("settles a probe the host never answers as not shared, after a bounded wait", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      mailbox.item = makeReadItem({
        // The ERMAIN-431 class: classic Win32 was seen dropping callbacks
        // entirely. Unbounded, this would pin every mail backend behind
        // `mailbox-location-pending` for the item's lifetime.
        getSharedPropertiesAsync: vi.fn(),
      });
      await renderProvider();
      expect(captured?.isLoadingSharedContext).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(captured?.isLoadingSharedContext).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(captured?.isLoadingSharedContext).toBe(false);
      expect(captured?.sharedContext).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  describe("same-item re-fires", () => {
    function deferredSharedProperties() {
      const callbacks: SharedPropertiesCallback[] = [];
      return {
        callbacks,
        getSharedPropertiesAsync: (cb: SharedPropertiesCallback) => {
          callbacks.push(cb);
        },
      };
    }

    // ItemChanged and SelectedItemsChanged both funnel into the handler the
    // provider registered first.
    async function fireSelectionChanged() {
      const handler = mailbox.addHandlerAsync.mock.calls[0][1] as () => void;
      await act(async () => {
        handler();
      });
    }

    it("keeps a committed shared context instead of going back to pending", async () => {
      const probe = deferredSharedProperties();
      mailbox.item = makeReadItem({
        getSharedPropertiesAsync: probe.getSharedPropertiesAsync,
      });
      await renderProvider();
      expect(captured?.isLoadingSharedContext).toBe(true);
      await act(async () => {
        probe.callbacks[0](createMockAsyncResult(sharedProperties()));
      });
      const committed = captured?.sharedContext;
      expect(committed?.owner).toBe("team@x");

      await fireSelectionChanged();

      // Re-probed, but never back to pending: a reset here flips the fetcher
      // null → new object and restarts every consumer keyed on it for a
      // byte-identical item.
      expect(probe.callbacks).toHaveLength(2);
      expect(captured?.isLoadingSharedContext).toBe(false);
      expect(captured?.sharedContext).toBe(committed);

      // A same item cannot change store: a failed re-probe is a transient
      // host answer, not a move.
      await act(async () => {
        probe.callbacks[1](createMockAsyncResult(undefined, "failed"));
      });
      expect(captured?.sharedContext).toBe(committed);
    });

    it("upgrades a committed 'not shared' answer when the re-probe finds the owner", async () => {
      const probe = deferredSharedProperties();
      mailbox.item = makeReadItem({
        getSharedPropertiesAsync: probe.getSharedPropertiesAsync,
      });
      await renderProvider();
      await act(async () => {
        probe.callbacks[0](createMockAsyncResult(undefined, "failed"));
      });
      expect(captured?.sharedContext).toBeNull();
      expect(captured?.isLoadingSharedContext).toBe(false);

      await fireSelectionChanged();
      expect(captured?.isLoadingSharedContext).toBe(false);
      await act(async () => {
        probe.callbacks[1](createMockAsyncResult(sharedProperties()));
      });
      expect(captured?.sharedContext?.owner).toBe("team@x");
    });

    it("probes afresh when the same item comes back after a deselect", async () => {
      const probe = deferredSharedProperties();
      const item = makeReadItem({
        getSharedPropertiesAsync: probe.getSharedPropertiesAsync,
      });
      mailbox.item = item;
      await renderProvider();
      await act(async () => {
        probe.callbacks[0](createMockAsyncResult(sharedProperties()));
      });
      expect(captured?.sharedContext?.owner).toBe("team@x");

      mailbox.item = null;
      await fireSelectionChanged();
      expect(captured?.sharedContext).toBeNull();

      mailbox.item = item;
      await fireSelectionChanged();
      // A → null → A: the null run already cleared the answer, so A must go
      // back through pending rather than be served as "not shared".
      expect(captured?.isLoadingSharedContext).toBe(true);
      expect(captured?.sharedContext).toBeNull();
      await act(async () => {
        probe.callbacks[1](createMockAsyncResult(sharedProperties()));
      });
      expect(captured?.sharedContext?.owner).toBe("team@x");
      expect(captured?.isLoadingSharedContext).toBe(false);
    });
  });
});
