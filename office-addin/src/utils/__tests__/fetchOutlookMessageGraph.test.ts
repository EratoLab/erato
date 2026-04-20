import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  fetchOutlookMessageFilesByInternetMessageIdViaGraph,
  fetchOutlookMessageFilesViaGraph,
} from "../fetchOutlookMessageGraph";

const EWS_ID = "AAkALgAAA-ews-id";
const GRAPH_ID = "graph-id-converted";

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  convertToRestId: ReturnType<typeof vi.fn>;
};

function installOutlookMailboxMock(): MailboxMock {
  const mailbox = installMockMailbox() as MailboxMock;
  (Office.MailboxEnums as unknown as Record<string, unknown>).RestVersion = {
    v2_0: "v2.0",
  };
  mailbox.convertToRestId = vi.fn().mockReturnValue(GRAPH_ID);
  return mailbox;
}

function installFetchMock(
  responder: (
    url: string,
    init?: RequestInit,
  ) => {
    ok: boolean;
    status?: number;
    statusText?: string;
    jsonValue?: unknown;
  },
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const response = responder(url, init);
    return {
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      json: () => Promise.resolve(response.jsonValue ?? {}),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchOutlookMessageFilesViaGraph", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("hits the Graph v1.0 /me/messages endpoint with the converted id and the MSAL bearer token", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-token-xyz");
    const fetchMock = installFetchMock(() => ({
      ok: true,
      jsonValue: {
        subject: "Test",
        body: { contentType: "text", content: "plain" },
        attachments: [],
      },
    }));

    await fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken);

    expect(acquireToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(GRAPH_ID)}?$expand=attachments`,
    );
    expect(url).toContain("internetMessageId");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer graph-token-xyz");
  });

  it("builds an HTML body file with rendered headers for a camelCase Graph message", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        subject: "Hey how are you?",
        body: { contentType: "text", content: "plain text body" },
        from: { emailAddress: { name: "Alice", address: "alice@x" } },
        toRecipients: [{ emailAddress: { address: "bob@x" } }],
        attachments: [],
      },
    }));

    const { subject, files } = await fetchOutlookMessageFilesViaGraph(
      EWS_ID,
      acquireToken,
    );
    expect(subject).toBe("Hey how are you?");
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("text/html");
    const html = await files[0].text();
    expect(html).toContain("<strong>From:</strong> Alice &lt;alice@x&gt;");
    expect(html).toContain("<strong>To:</strong> bob@x");
    expect(html).toContain("<pre>plain text body</pre>");
  });

  it("decodes Graph fileAttachment entries into File objects", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const base64 = btoa("pdf-bytes");
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        subject: "With attachment",
        body: { contentType: "text", content: "see attached" },
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: "doc.pdf",
            contentType: "application/pdf",
            size: 9,
            isInline: false,
            contentBytes: base64,
          },
        ],
      },
    }));

    const { files } = await fetchOutlookMessageFilesViaGraph(
      EWS_ID,
      acquireToken,
    );
    expect(files).toHaveLength(2);
    expect(files[1].name).toBe("doc.pdf");
    expect(files[1].type).toBe("application/pdf");
    expect(await files[1].text()).toBe("pdf-bytes");
  });

  it("surfaces internetMessageId from the Graph response in the return value", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        subject: "With id",
        body: { contentType: "text", content: "x" },
        internetMessageId: "<abc@host>",
        attachments: [],
      },
    }));

    const result = await fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken);
    expect(result.internetMessageId).toBe("<abc@host>");
  });

  it("throws when Graph returns a non-OK status", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }));

    await expect(
      fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken),
    ).rejects.toThrow(/Graph fetch failed: 403 Forbidden/);
  });
});

describe("fetchOutlookMessageFilesByInternetMessageIdViaGraph", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("filters /me/messages by internetMessageId and then fetches the matched message", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return {
          ok: true,
          jsonValue: {
            value: [{ id: "matched-graph-id", subject: "Matched" }],
          },
        };
      }
      return {
        ok: true,
        jsonValue: {
          id: "matched-graph-id",
          subject: "Matched",
          body: { contentType: "text", content: "body" },
          attachments: [],
        },
      };
    });

    const result = await fetchOutlookMessageFilesByInternetMessageIdViaGraph(
      "<abc@host>",
      acquireToken,
    );

    expect(result).not.toBeNull();
    expect(result?.subject).toBe("Matched");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [filterUrl] = fetchMock.mock.calls[0];
    expect(filterUrl).toContain(
      encodeURIComponent("internetMessageId eq '<abc@host>'"),
    );
    const [fetchUrl] = fetchMock.mock.calls[1];
    expect(fetchUrl).toContain(
      `/me/messages/${encodeURIComponent("matched-graph-id")}`,
    );
  });

  it("returns null when Graph's filter yields no matches", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({ ok: true, jsonValue: { value: [] } }));

    const result = await fetchOutlookMessageFilesByInternetMessageIdViaGraph(
      "<missing@host>",
      acquireToken,
    );

    expect(result).toBeNull();
  });

  it("escapes single quotes inside the internet message id for the OData filter", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return { ok: true, jsonValue: { value: [] } };
      }
      return { ok: true, jsonValue: {} };
    });

    await fetchOutlookMessageFilesByInternetMessageIdViaGraph(
      "<a'b@host>",
      acquireToken,
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent("internetMessageId eq '<a''b@host>'"),
    );
  });
});
