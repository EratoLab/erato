import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
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

  // A host leaking the pane into the calendar module: an AppointmentRead has a
  // string subject too, so without the guard it would masquerade as a read
  // message instead of resolving to the neutral no-item context.
  it("treats an appointment item as no item", async () => {
    mailbox.item = makeReadItem({ itemType: "appointment" });
    await renderProvider();
    expect(captured?.mailItem).toBeNull();
    expect(captured?.itemIdentity).toBeNull();
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
});
