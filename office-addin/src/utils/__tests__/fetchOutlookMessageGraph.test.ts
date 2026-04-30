import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  fetchOutlookMessageFilesByInternetMessageIdViaGraph,
  fetchOutlookMessageFilesViaGraph,
  fetchParentMessageInConversationViaGraph,
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

interface MockResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  jsonValue?: unknown;
  bytes?: ArrayBuffer;
}

function installFetchMock(
  responder: (url: string, init?: RequestInit) => MockResponse,
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const response = responder(url, init);
    return {
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      json: () => Promise.resolve(response.jsonValue ?? {}),
      arrayBuffer: () => Promise.resolve(response.bytes ?? new ArrayBuffer(0)),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bytesFrom(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

describe("fetchOutlookMessageFilesViaGraph", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("requests metadata then the raw MIME $value with the converted id and the MSAL bearer token", async () => {
    const acquireToken = vi.fn().mockResolvedValue("graph-token-xyz");
    const fetchMock = installFetchMock((url) => {
      if (url.endsWith("/$value")) {
        return { ok: true, bytes: bytesFrom("raw-mime") };
      }
      return {
        ok: true,
        jsonValue: { subject: "Test", internetMessageId: "<abc@host>" },
      };
    });

    await fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken);

    expect(acquireToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [metadataUrl, metadataInit] = fetchMock.mock.calls[0];
    expect(metadataUrl).toContain(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(GRAPH_ID)}?$select=`,
    );
    expect(metadataUrl).toContain("internetMessageId");
    const metadataHeaders = (metadataInit as RequestInit).headers as Record<
      string,
      string
    >;
    expect(metadataHeaders.Authorization).toBe("Bearer graph-token-xyz");

    const [valueUrl, valueInit] = fetchMock.mock.calls[1];
    expect(valueUrl).toBe(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(GRAPH_ID)}/$value`,
    );
    const valueHeaders = (valueInit as RequestInit).headers as Record<
      string,
      string
    >;
    expect(valueHeaders.Accept).toBe("application/octet-stream");
    expect(valueHeaders.Authorization).toBe("Bearer graph-token-xyz");
  });

  it("returns a single .eml File wrapping the RFC822 stream, named after the subject", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) => {
      if (url.endsWith("/$value")) {
        return { ok: true, bytes: bytesFrom("MIME-Version: 1.0\r\n\r\nhi") };
      }
      return { ok: true, jsonValue: { subject: "Weekly sync notes" } };
    });

    const { subject, files } = await fetchOutlookMessageFilesViaGraph(
      EWS_ID,
      acquireToken,
    );
    expect(subject).toBe("Weekly sync notes");
    expect(files).toHaveLength(1);
    const eml = files[0];
    expect(eml.type).toBe("message/rfc822");
    expect(eml.name).toBe("Weekly sync notes.eml");
    expect(await eml.text()).toBe("MIME-Version: 1.0\r\n\r\nhi");
  });

  it("sanitises filesystem-hostile characters in the subject-derived filename", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom("x") }
        : { ok: true, jsonValue: { subject: "Re: a/b\\c<d>|?" } },
    );

    const { files } = await fetchOutlookMessageFilesViaGraph(
      EWS_ID,
      acquireToken,
    );
    expect(files[0].name).toBe("Re_ a_b_c_d___.eml");
  });

  it("falls back to message.eml when the subject is missing or blank", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom("x") }
        : { ok: true, jsonValue: {} },
    );

    const { files, subject } = await fetchOutlookMessageFilesViaGraph(
      EWS_ID,
      acquireToken,
    );
    expect(subject).toBe("");
    expect(files[0].name).toBe("message.eml");
  });

  it("surfaces internetMessageId from the metadata response in the return value", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom("x") }
        : {
            ok: true,
            jsonValue: { subject: "With id", internetMessageId: "<abc@host>" },
          },
    );

    const result = await fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken);
    expect(result.internetMessageId).toBe("<abc@host>");
  });

  it("throws when the metadata request returns a non-OK status", async () => {
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

  it("throws when the $value request returns a non-OK status", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: false, status: 404, statusText: "Not Found" }
        : { ok: true, jsonValue: { subject: "x" } },
    );

    await expect(
      fetchOutlookMessageFilesViaGraph(EWS_ID, acquireToken),
    ).rejects.toThrow(/Graph MIME fetch failed: 404 Not Found/);
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

  it("filters /me/messages by internetMessageId then fetches the matched message's raw MIME", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return {
          ok: true,
          jsonValue: {
            value: [
              {
                id: "matched-graph-id",
                subject: "Matched",
                internetMessageId: "<abc@host>",
              },
            ],
          },
        };
      }
      return { ok: true, bytes: bytesFrom("raw") };
    });

    const result = await fetchOutlookMessageFilesByInternetMessageIdViaGraph(
      "<abc@host>",
      acquireToken,
    );

    expect(result).not.toBeNull();
    expect(result?.subject).toBe("Matched");
    expect(result?.internetMessageId).toBe("<abc@host>");
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].type).toBe("message/rfc822");
    expect(result?.files[0].name).toBe("Matched.eml");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [filterUrl] = fetchMock.mock.calls[0];
    expect(filterUrl).toContain(
      encodeURIComponent("internetMessageId eq '<abc@host>'"),
    );
    const [valueUrl] = fetchMock.mock.calls[1];
    expect(valueUrl).toBe(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent("matched-graph-id")}/$value`,
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
      return { ok: true, bytes: bytesFrom("x") };
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

describe("fetchParentMessageInConversationViaGraph", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("filters /me/messages by conversationId and isDraft, ordered by receivedDateTime desc, top 1", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock(() => ({
      ok: true,
      jsonValue: {
        value: [
          {
            subject: "Re: Quarterly review",
            from: {
              emailAddress: {
                name: "Alice Sender",
                address: "alice@example.com",
              },
            },
          },
        ],
      },
    }));

    const result = await fetchParentMessageInConversationViaGraph(
      "AAQkAGE5...convId",
      acquireToken,
    );

    expect(result).toEqual({
      subject: "Re: Quarterly review",
      fromName: "Alice Sender",
      fromAddress: "alice@example.com",
    });
    expect(acquireToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent(
        "conversationId eq 'AAQkAGE5...convId' and isDraft eq false",
      ),
    );
    expect(url).toContain(encodeURIComponent("receivedDateTime desc"));
    expect(url).toContain("$top=1");
    expect(url).toContain("$select=subject,from");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("returns null when the conversation has no indexed messages", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({ ok: true, jsonValue: { value: [] } }));

    const result = await fetchParentMessageInConversationViaGraph(
      "fresh-conv",
      acquireToken,
    );

    expect(result).toBeNull();
  });

  it("returns null on Graph error rather than throwing", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const result = await fetchParentMessageInConversationViaGraph(
      "any-conv",
      acquireToken,
    );

    expect(result).toBeNull();
  });

  it("escapes single quotes in conversationId for the OData filter", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock(() => ({
      ok: true,
      jsonValue: { value: [] },
    }));

    await fetchParentMessageInConversationViaGraph(
      "conv'with'quotes",
      acquireToken,
    );

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent(
        "conversationId eq 'conv''with''quotes' and isDraft eq false",
      ),
    );
  });

  it("falls back to null name/address when Graph response is missing fields", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        value: [{ subject: "Subject only" }],
      },
    }));

    const result = await fetchParentMessageInConversationViaGraph(
      "conv",
      acquireToken,
    );

    expect(result).toEqual({
      subject: "Subject only",
      fromName: null,
      fromAddress: null,
    });
  });
});
