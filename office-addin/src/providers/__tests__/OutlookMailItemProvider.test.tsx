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

  // Regression: cleanup must remove the *registered* handler, not a throwaway
  // closure (which removes nothing and leaks the handler under StrictMode).
  it("unsubscribes with the registered handler", async () => {
    mailbox.item = makeReadItem();
    const { unmount } = await renderProvider();

    const registered = mailbox.addHandlerAsync.mock.calls[0][1];
    act(() => {
      unmount();
    });

    expect(mailbox.removeHandlerAsync).toHaveBeenCalled();
    expect(mailbox.removeHandlerAsync.mock.calls[0][1]).toBe(registered);
  });
});
