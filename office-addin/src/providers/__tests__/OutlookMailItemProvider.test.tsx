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
