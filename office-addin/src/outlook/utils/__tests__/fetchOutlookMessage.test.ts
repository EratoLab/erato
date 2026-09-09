import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../../test/mocks/outlook/mailbox";
import { createGraphOutlookMessageFetcher } from "../fetchOutlookMessage";

import type { OutlookMessageFetcher } from "../fetchOutlookMessage";

const EWS_ID = "AAkALgAAA-ews-id";
const GRAPH_ID = "graph-id-converted";
const OWNER = "shared+box@contoso.com";
const OWNER_ROOT = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(OWNER)}`;
const OWN_ROOT = "https://graph.microsoft.com/v1.0/me";

/** Answers every request shape the five capabilities issue: a metadata GET, an
 * OData `$filter` lookup, and a raw `/$value` stream. */
function installFetchMock() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/$value")) {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      } as Response;
    }
    const jsonValue = url.includes("$filter=")
      ? { value: [{ id: "matched-id", subject: "Matched", isDraft: false }] }
      : { subject: "Matched", internetMessageId: "<abc@host>" };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(jsonValue),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const capabilities: Array<{
  name: string;
  invoke: (fetcher: OutlookMessageFetcher) => Promise<unknown>;
}> = [
  { name: "fetchMessageBytes", invoke: (f) => f.fetchMessageBytes(EWS_ID) },
  {
    name: "fetchMessageFilesByInternetMessageId",
    invoke: (f) => f.fetchMessageFilesByInternetMessageId("<abc@host>"),
  },
  {
    name: "fetchMessageBytesByInternetMessageId",
    invoke: (f) => f.fetchMessageBytesByInternetMessageId("<abc@host>"),
  },
  {
    name: "fetchConversationMessages",
    invoke: (f) => f.fetchConversationMessages("conv-1"),
  },
  {
    name: "fetchParentMessageInConversation",
    invoke: (f) => f.fetchParentMessageInConversation("conv-1"),
  },
];

describe("createGraphOutlookMessageFetcher", () => {
  beforeEach(() => {
    const mailbox = installMockMailbox() as ReturnType<
      typeof installMockMailbox
    > & { convertToRestId: ReturnType<typeof vi.fn> };
    (Office.MailboxEnums as unknown as Record<string, unknown>).RestVersion = {
      v2_0: "v2.0",
    };
    mailbox.convertToRestId = vi.fn().mockReturnValue(GRAPH_ID);
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it.each(capabilities)(
    "$name reaches the bound owner's mailbox",
    async ({ invoke }) => {
      const fetchMock = installFetchMock();
      const fetcher = createGraphOutlookMessageFetcher(
        vi.fn().mockResolvedValue("tok"),
        { owner: OWNER },
      );

      await invoke(fetcher);

      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
      for (const [url] of fetchMock.mock.calls) {
        expect(url.startsWith(`${OWNER_ROOT}/messages`)).toBe(true);
      }
    },
  );

  it.each(capabilities)(
    "$name reaches the signed-in user's own mailbox when no owner is bound",
    async ({ invoke }) => {
      const fetchMock = installFetchMock();
      const fetcher = createGraphOutlookMessageFetcher(
        vi.fn().mockResolvedValue("tok"),
      );

      await invoke(fetcher);

      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
      for (const [url] of fetchMock.mock.calls) {
        expect(url.startsWith(`${OWN_ROOT}/messages`)).toBe(true);
      }
    },
  );

  it("keeps the bound owner in charge of a stray owner reaching the seam", async () => {
    const fetchMock = installFetchMock();
    const fetcher = createGraphOutlookMessageFetcher(
      vi.fn().mockResolvedValue("tok"),
      { owner: OWNER },
    );

    // The seam's option type deliberately has no `owner`, so this cast is the
    // only way to reach the case — it guards the factory's spread order, which
    // is what stops an untyped caller from redirecting a bound fetcher at
    // another mailbox.
    await fetcher.fetchConversationMessages("conv-1", {
      owner: "someone-else@contoso.com",
    } as Parameters<typeof fetcher.fetchConversationMessages>[1]);

    for (const [url] of fetchMock.mock.calls) {
      expect(url.startsWith(`${OWNER_ROOT}/messages`)).toBe(true);
    }
  });

  it("passes the call site's abort signal through alongside the bound owner", async () => {
    const fetchMock = installFetchMock();
    const controller = new AbortController();
    const fetcher = createGraphOutlookMessageFetcher(
      vi.fn().mockResolvedValue("tok"),
      { owner: OWNER },
    );

    await fetcher.fetchParentMessageInConversation("conv-1", {
      signal: controller.signal,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBe(controller.signal);
  });
});
