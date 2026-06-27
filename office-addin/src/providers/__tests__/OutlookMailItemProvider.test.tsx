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

// office-js #5575 dead-state recovery (ERMAIN-411). These tests drive the
// provider through the falsy-item transitions that the new Outlook for Mac bug
// produces and assert that `itemContextLost` is set ONLY for the disambiguated
// dead state (a previously-open READ message that stayed gone past the settle
// window) — never for cold-open, the compose null-flap, or a quick recovery.

type Mailbox = ReturnType<typeof installMockMailbox>;
type ContextValue = ReturnType<typeof useOutlookMailItem>;

// Comfortably past the provider's DEAD_STATE_SETTLE_MS (2500ms).
const PAST_SETTLE_MS = 3000;

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

function makeComposeItem() {
  const okText = (cb: (r: unknown) => void) => cb(createMockAsyncResult(""));
  const okList = (cb: (r: unknown) => void) => cb(createMockAsyncResult([]));
  return {
    // Non-string subject => `isMessageRead` returns false (compose).
    conversationId: "conv-compose",
    subject: { getAsync: okText },
    to: { getAsync: okList },
    cc: { getAsync: okList },
    body: {
      getAsync: (_coercion: unknown, cb: (r: unknown) => void) =>
        cb(createMockAsyncResult("")),
    },
    getAttachmentsAsync: okList,
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

/** The ItemChanged handler the provider registered with the mailbox. */
function selectionHandler(): () => void {
  const call = mailbox.addHandlerAsync.mock.calls[0];
  return call[1] as () => void;
}

/** Point the mailbox at `item` and fire the registered selection handler. */
async function selectItem(item: unknown) {
  mailbox.item = item;
  await act(async () => {
    selectionHandler()();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mailbox = installMockMailbox();
  captured = null;
});

afterEach(() => {
  cleanup();
  uninstallMockMailbox();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("OutlookMailItemProvider dead-state recovery", () => {
  it("surfaces itemContextLost after the settle window when a read item silently goes away", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();
    expect(captured?.mailItem?.internetMessageId).toBe("<read-1@x>");
    expect(captured?.itemContextLost).toBe(false);

    // The #5575 drop: item becomes falsy while ItemChanged still fires.
    await selectItem(null);
    expect(captured?.mailItem).toBeNull();
    // Still within the settle window — no banner yet.
    expect(captured?.itemContextLost).toBe(false);

    await advance(1000);
    expect(captured?.itemContextLost).toBe(false);

    await advance(PAST_SETTLE_MS);
    expect(captured?.itemContextLost).toBe(true);
  });

  it("never arms on cold-open with no prior item (legitimate contextless state)", async () => {
    mailbox.item = null;
    await renderProvider();
    expect(captured?.itemContextLost).toBe(false);

    await advance(PAST_SETTLE_MS);
    expect(captured?.itemContextLost).toBe(false);
  });

  it("does not arm when the prior item was a compose surface (reply/inline null-flap)", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();

    // Move into compose (clears the last-read anchor), then lose the item.
    await selectItem(makeComposeItem());
    expect(captured?.mailItem?.isComposeMode).toBe(true);

    await selectItem(null);
    await advance(PAST_SETTLE_MS);
    expect(captured?.itemContextLost).toBe(false);
  });

  it("cancels the pending banner when a real item is reselected before the settle", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();

    await selectItem(null);
    await advance(1000);
    expect(captured?.itemContextLost).toBe(false);

    // Reselect a real read item before the settle elapses.
    await selectItem(makeReadItem({ internetMessageId: "<read-2@x>" }));
    expect(captured?.mailItem?.internetMessageId).toBe("<read-2@x>");

    await advance(PAST_SETTLE_MS);
    expect(captured?.itemContextLost).toBe(false);
  });

  it("recovers silently if the item returns by the time the settle fires (no banner)", async () => {
    mailbox.item = makeReadItem();
    await renderProvider();

    await selectItem(null);
    // Item quietly comes back WITHOUT another ItemChanged event.
    mailbox.item = makeReadItem({ internetMessageId: "<read-3@x>" });

    await advance(PAST_SETTLE_MS);
    expect(captured?.itemContextLost).toBe(false);
    expect(captured?.mailItem?.internetMessageId).toBe("<read-3@x>");
  });

  it("unsubscribes with the registered handler (no leaked handler under StrictMode)", async () => {
    mailbox.item = makeReadItem();
    const { unmount } = await renderProvider();

    const registered = selectionHandler();
    act(() => {
      unmount();
    });

    expect(mailbox.removeHandlerAsync).toHaveBeenCalled();
    expect(mailbox.removeHandlerAsync.mock.calls[0][1]).toBe(registered);
  });
});
