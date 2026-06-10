import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  fetchConversationMessagesViaRestV2,
  fetchOutlookMessageBytesViaRestV2,
  fetchOutlookMessageFilesByInternetMessageIdViaRestV2,
  fetchOutlookMessageFilesViaRestV2,
  fetchParentMessageInConversationViaRestV2,
} from "../fetchOutlookMessageRestV2";

import type { GraphTransport } from "../fetchOutlookMessageGraph";

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  convertToRestId: ReturnType<typeof vi.fn>;
  getCallbackTokenAsync: ReturnType<typeof vi.fn>;
  restUrl?: string;
};

const EWS_ID = "AAkALgAAA-ews-id";
const REST_ID = "rest-id-converted";
// `Office.context.mailbox.restUrl` names the REST root INCLUDING the `/api`
// segment; URLs are built by appending only `/v2.0/…`.
const REST_BASE = "https://exchange.example.com/api";

interface MockResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  jsonValue?: unknown;
  bytes?: ArrayBuffer;
  /** Response header values keyed by name (e.g. `Retry-After`); read via the
   * `headers.get` shim the production code uses. */
  headers?: Record<string, string>;
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

function installOutlookMailboxMock(): MailboxMock {
  const mailbox = installMockMailbox() as MailboxMock;
  (Office.MailboxEnums as unknown as Record<string, unknown>).RestVersion = {
    v2_0: "v2.0",
  };
  mailbox.convertToRestId = vi.fn().mockReturnValue(REST_ID);
  mailbox.getCallbackTokenAsync = vi.fn((_options, callback) => {
    callback(createMockAsyncResult("bearer-token-abc"));
  });
  mailbox.restUrl = REST_BASE;
  return mailbox;
}

describe("fetchOutlookMessageFilesViaRestV2", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("assembles the REST URL with converted id and bearer token", async () => {
    const fetchMock = installFetchMock(() => ({
      ok: true,
      jsonValue: {
        Subject: "Test",
        Body: { ContentType: "Text", Content: "hello" },
        Attachments: [],
      },
    }));

    await fetchOutlookMessageFilesViaRestV2(EWS_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${REST_BASE}/v2.0/me/messages/${encodeURIComponent(REST_ID)}?$expand=Attachments`,
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bearer-token-abc");
    expect(headers.Accept).toBe("application/json");
  });

  it("builds an HTML body file with rendered headers from a text-body message", async () => {
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        Subject: "Hey how are you?",
        Body: { ContentType: "Text", Content: "plain text body" },
        From: { EmailAddress: { Name: "Alice", Address: "alice@x" } },
        ToRecipients: [{ EmailAddress: { Address: "bob@x" } }],
        Attachments: [],
      },
    }));

    const { subject, files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    expect(subject).toBe("Hey how are you?");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Hey how are you_.html");
    expect(files[0].type).toBe("text/html");

    const html = await files[0].text();
    expect(html).toContain("<strong>From:</strong> Alice &lt;alice@x&gt;");
    expect(html).toContain("<strong>To:</strong> bob@x");
    expect(html).toContain("<strong>Subject:</strong> Hey how are you?");
    expect(html).toContain("<pre>plain text body</pre>");
  });

  it("keeps HTML-body content verbatim rather than wrapping in <pre>", async () => {
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        Subject: "Formatted",
        Body: { ContentType: "HTML", Content: "<p>rich</p>" },
        Attachments: [],
      },
    }));

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    const html = await files[0].text();
    expect(html).toContain("<p>rich</p>");
    expect(html).not.toContain("<pre>");
  });

  it("decodes FileAttachment entries into File objects", async () => {
    const base64 = btoa("hello-pdf-bytes");
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        Subject: "With attachment",
        Body: { ContentType: "Text", Content: "see attached" },
        Attachments: [
          {
            "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
            Name: "doc.pdf",
            ContentType: "application/pdf",
            Size: 14,
            IsInline: false,
            ContentBytes: base64,
          },
        ],
      },
    }));

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    expect(files).toHaveLength(2);
    const attachment = files[1];
    expect(attachment.name).toBe("doc.pdf");
    expect(attachment.type).toBe("application/pdf");
    expect(await attachment.text()).toBe("hello-pdf-bytes");
  });

  it("skips inline attachments and non-file attachment types", async () => {
    installFetchMock(() => ({
      ok: true,
      jsonValue: {
        Subject: "Mixed",
        Body: { ContentType: "Text", Content: "x" },
        Attachments: [
          {
            "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
            Name: "inline.png",
            ContentType: "image/png",
            IsInline: true,
            ContentBytes: btoa("inline"),
          },
          {
            "@odata.type": "#Microsoft.OutlookServices.ItemAttachment",
            Name: "nested.msg",
          },
          {
            "@odata.type": "#Microsoft.OutlookServices.ReferenceAttachment",
            Name: "cloud-link",
          },
        ],
      },
    }));

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Mixed.html");
  });

  it("throws when the REST endpoint returns a non-OK status", async () => {
    installFetchMock(() => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }));

    await expect(fetchOutlookMessageFilesViaRestV2(EWS_ID)).rejects.toThrow(
      /Outlook REST fetch failed: 403 Forbidden/,
    );
  });

  it("throws when mailbox.restUrl is not available", async () => {
    const mailbox = Office.context.mailbox as unknown as {
      restUrl?: string;
    };
    mailbox.restUrl = undefined;
    installFetchMock(() => ({ ok: true }));

    await expect(fetchOutlookMessageFilesViaRestV2(EWS_ID)).rejects.toThrow(
      /restUrl is not available/,
    );
  });
});

describe("fetchOutlookMessageBytesViaRestV2", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("requests metadata then the raw MIME $value with the converted id and the callback token", async () => {
    const fetchMock = installFetchMock((url) => {
      if (url.endsWith("/$value")) {
        return { ok: true, bytes: bytesFrom("raw-mime") };
      }
      return {
        ok: true,
        jsonValue: { Subject: "Test", InternetMessageId: "<abc@host>" },
      };
    });

    const result = await fetchOutlookMessageBytesViaRestV2(EWS_ID);

    expect(result.subject).toBe("Test");
    expect(result.internetMessageId).toBe("<abc@host>");
    expect(new TextDecoder().decode(result.bytes)).toBe("raw-mime");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [metadataUrl, metadataInit] = fetchMock.mock.calls[0];
    expect(metadataUrl).toBe(
      `${REST_BASE}/v2.0/me/messages/${encodeURIComponent(REST_ID)}?$select=Subject,InternetMessageId`,
    );
    const metadataHeaders = (metadataInit as RequestInit).headers as Record<
      string,
      string
    >;
    expect(metadataHeaders.Authorization).toBe("Bearer bearer-token-abc");

    const [valueUrl, valueInit] = fetchMock.mock.calls[1];
    expect(valueUrl).toBe(
      `${REST_BASE}/v2.0/me/messages/${encodeURIComponent(REST_ID)}/$value`,
    );
    const valueHeaders = (valueInit as RequestInit).headers as Record<
      string,
      string
    >;
    expect(valueHeaders.Accept).toBe("application/octet-stream");
    expect(valueHeaders.Authorization).toBe("Bearer bearer-token-abc");
  });

  it("re-acquires the callback token and retries once on a 401", async () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    let tokenIndex = 0;
    mailbox.getCallbackTokenAsync = vi.fn((_options, callback) => {
      tokenIndex += 1;
      callback(createMockAsyncResult(`token-${tokenIndex}`));
    });
    const fetchMock = installFetchMock((url, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)
        ?.Authorization;
      // The first attempt carries the expired cached token and is rejected.
      if (auth === "Bearer token-1") {
        return { ok: false, status: 401, statusText: "Unauthorized" };
      }
      if (url.endsWith("/$value")) {
        return { ok: true, bytes: bytesFrom("raw-mime") };
      }
      return { ok: true, jsonValue: { Subject: "Recovered" } };
    });

    const result = await fetchOutlookMessageBytesViaRestV2(EWS_ID);

    expect(result.subject).toBe("Recovered");
    expect(mailbox.getCallbackTokenAsync).toHaveBeenCalledTimes(2);
    // metadata(expired → 401) → metadata(fresh) → $value(fresh, reuses cache).
    const authorizations = fetchMock.mock.calls.map(
      (call) =>
        ((call[1] as RequestInit).headers as Record<string, string>)
          .Authorization,
    );
    expect(authorizations).toEqual([
      "Bearer token-1",
      "Bearer token-2",
      "Bearer token-2",
    ]);
  });

  it("throws when the metadata request returns a non-OK status", async () => {
    installFetchMock(() => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }));

    await expect(fetchOutlookMessageBytesViaRestV2(EWS_ID)).rejects.toThrow(
      /Outlook REST fetch failed: 403 Forbidden/,
    );
  });

  it("throws when the $value request returns a non-OK status", async () => {
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: false, status: 404, statusText: "Not Found" }
        : { ok: true, jsonValue: { Subject: "x" } },
    );

    await expect(fetchOutlookMessageBytesViaRestV2(EWS_ID)).rejects.toThrow(
      /Outlook REST MIME fetch failed: 404 Not Found/,
    );
  });
});

describe("fetchOutlookMessageFilesByInternetMessageIdViaRestV2", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("filters /me/messages by InternetMessageId then fetches the matched message's raw MIME", async () => {
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return {
          ok: true,
          jsonValue: {
            value: [
              {
                Id: "matched-rest-id",
                Subject: "Matched",
                InternetMessageId: "<abc@host>",
              },
            ],
          },
        };
      }
      return { ok: true, bytes: bytesFrom("raw") };
    });

    const result =
      await fetchOutlookMessageFilesByInternetMessageIdViaRestV2("<abc@host>");

    expect(result).not.toBeNull();
    expect(result?.subject).toBe("Matched");
    expect(result?.internetMessageId).toBe("<abc@host>");
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].type).toBe("message/rfc822");
    expect(result?.files[0].name).toBe("Matched.eml");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [filterUrl] = fetchMock.mock.calls[0];
    expect(filterUrl).toBe(
      `${REST_BASE}/v2.0/me/messages?$filter=${encodeURIComponent(
        "InternetMessageId eq '<abc@host>'",
      )}&$top=1&$select=Id,Subject,InternetMessageId`,
    );
    const [valueUrl] = fetchMock.mock.calls[1];
    expect(valueUrl).toBe(
      `${REST_BASE}/v2.0/me/messages/${encodeURIComponent("matched-rest-id")}/$value`,
    );
  });

  it("returns null when the filter yields no matches", async () => {
    installFetchMock(() => ({ ok: true, jsonValue: { value: [] } }));

    const result =
      await fetchOutlookMessageFilesByInternetMessageIdViaRestV2(
        "<missing@host>",
      );

    expect(result).toBeNull();
  });

  it("escapes single quotes inside the internet message id for the OData filter", async () => {
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return { ok: true, jsonValue: { value: [] } };
      }
      return { ok: true, bytes: bytesFrom("x") };
    });

    await fetchOutlookMessageFilesByInternetMessageIdViaRestV2("<a'b@host>");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(
      encodeURIComponent("InternetMessageId eq '<a''b@host>'"),
    );
  });

  it("throws when the lookup returns a non-OK status", async () => {
    installFetchMock(() => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    await expect(
      fetchOutlookMessageFilesByInternetMessageIdViaRestV2("<abc@host>"),
    ).rejects.toThrow(/Outlook REST lookup failed: 500 Internal Server Error/);
  });
});

describe("fetchParentMessageInConversationViaRestV2", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("filters by ConversationId only ($top 20, no $orderby) and returns the latest non-draft", async () => {
    const fetchMock = installFetchMock(() => ({
      ok: true,
      jsonValue: {
        value: [
          {
            Subject: "Earlier reply",
            ReceivedDateTime: "2026-04-27T08:00:00Z",
            IsDraft: false,
            From: { EmailAddress: { Name: "Bob", Address: "bob@x" } },
          },
          {
            Subject: "My in-progress draft",
            ReceivedDateTime: "2026-04-29T11:00:00Z",
            IsDraft: true,
            From: { EmailAddress: { Name: "Me", Address: "me@x" } },
          },
          {
            Subject: "Latest non-draft",
            ReceivedDateTime: "2026-04-29T09:00:00Z",
            IsDraft: false,
            From: { EmailAddress: { Name: "Carol", Address: "carol@x" } },
          },
        ],
      },
    }));

    const result = await fetchParentMessageInConversationViaRestV2("conv'1");

    expect(result).toEqual({
      subject: "Latest non-draft",
      fromName: "Carol",
      fromAddress: "carol@x",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent("ConversationId eq 'conv''1'"));
    expect(url).toContain("$top=20");
    expect(url).toContain("$select=Id,Subject,From,ReceivedDateTime,IsDraft");
    expect(url).not.toContain("$orderby");
  });

  it("returns null when the conversation has no indexed messages", async () => {
    installFetchMock(() => ({ ok: true, jsonValue: { value: [] } }));

    const result = await fetchParentMessageInConversationViaRestV2("fresh");

    expect(result).toBeNull();
  });

  it("returns null on a REST error rather than throwing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installFetchMock(() => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    }));

    const result = await fetchParentMessageInConversationViaRestV2("any");

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null instead of throwing when restUrl is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (Office.context.mailbox as unknown as MailboxMock).restUrl = undefined;
    installFetchMock(() => ({ ok: true, jsonValue: { value: [] } }));

    const result = await fetchParentMessageInConversationViaRestV2("any");

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });
});

describe("fetchConversationMessagesViaRestV2", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  function makeTransport(
    responder: (url: string, init?: RequestInit) => MockResponse,
  ): GraphTransport {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const response = responder(url, init);
      return {
        ok: response.ok,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        json: async () => response.jsonValue ?? {},
        arrayBuffer: async () => response.bytes ?? new ArrayBuffer(0),
        headers: {
          get: (name: string) => response.headers?.[name] ?? null,
        },
      } as unknown as Response;
    });
  }

  it("queries with the PascalCase $filter/$select/$expand and maps rows onto the Graph-cased shape", async () => {
    const transport = makeTransport(() => ({
      ok: true,
      jsonValue: {
        value: [
          {
            Id: "m1",
            InternetMessageId: "<m1@x>",
            Subject: "Kickoff",
            From: { EmailAddress: { Name: "Alice", Address: "alice@x" } },
            ToRecipients: [{ EmailAddress: { Address: "bob@x" } }],
            CcRecipients: [],
            SentDateTime: "2026-03-01T09:59:00Z",
            ReceivedDateTime: "2026-03-01T10:00:00Z",
            Body: { ContentType: "HTML", Content: "<p>hello</p>" },
            UniqueBody: { ContentType: "Text", Content: "hello" },
            IsDraft: false,
            HasAttachments: true,
            Attachments: [
              {
                "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
                Id: "att-1",
                Name: "doc.pdf",
                ContentType: "application/pdf",
                Size: 7,
                IsInline: false,
                ContentBytes: btoa("pdf-doc"),
                ContentId: "cid-1",
              },
              {
                "@odata.type": "#Microsoft.OutlookServices.ReferenceAttachment",
                Id: "att-2",
                Name: "cloud-link",
              },
            ],
          },
        ],
      },
    }));

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("ok");
    const [url, init] = vi.mocked(transport).mock.calls[0];
    expect(url).toContain(`${REST_BASE}/v2.0/me/messages?$filter=`);
    expect(url).toContain(encodeURIComponent("ConversationId eq 'conv-1'"));
    expect(url).toContain("$top=50");
    expect(url).toContain(
      "$select=Id,InternetMessageId,Subject,From,ToRecipients,CcRecipients,SentDateTime,ReceivedDateTime,Body,UniqueBody,IsDraft,HasAttachments",
    );
    expect(url).toContain("$expand=Attachments");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bearer-token-abc");

    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message.id).toBe("m1");
    expect(message.internetMessageId).toBe("<m1@x>");
    expect(message.subject).toBe("Kickoff");
    expect(message.from).toEqual({
      emailAddress: { name: "Alice", address: "alice@x" },
    });
    expect(message.toRecipients).toEqual([
      { emailAddress: { name: undefined, address: "bob@x" } },
    ]);
    expect(message.sentDateTime).toBe("2026-03-01T09:59:00Z");
    expect(message.receivedDateTime).toBe("2026-03-01T10:00:00Z");
    expect(message.body).toEqual({
      contentType: "html",
      content: "<p>hello</p>",
    });
    expect(message.uniqueBody).toEqual({
      contentType: "text",
      content: "hello",
    });
    expect(message.isDraft).toBe(false);
    expect(message.hasAttachments).toBe(true);
    expect(message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        id: "att-1",
        name: "doc.pdf",
        contentType: "application/pdf",
        size: 7,
        isInline: false,
        contentBytes: btoa("pdf-doc"),
        contentId: "cid-1",
      },
      {
        "@odata.type": "#microsoft.graph.referenceAttachment",
        id: "att-2",
        name: "cloud-link",
        contentType: undefined,
        size: undefined,
        isInline: undefined,
        contentBytes: undefined,
        contentId: undefined,
      },
    ]);
  });

  it("follows @odata.nextLink across pages and concatenates the rows", async () => {
    const page2Url = `${REST_BASE}/v2.0/me/messages?page=2`;
    const transport = makeTransport((url) => {
      if (url === page2Url) {
        return {
          ok: true,
          jsonValue: { value: [{ Id: "m2", Subject: "Second" }] },
        };
      }
      return {
        ok: true,
        jsonValue: {
          value: [{ Id: "m1", Subject: "First" }],
          "@odata.nextLink": page2Url,
        },
      };
    });

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("ok");
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("reports partial when a later page fails after a successful first page", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page2Url = `${REST_BASE}/v2.0/me/messages?page=2`;
    const transport = makeTransport((url) => {
      if (url === page2Url) {
        return { ok: false, status: 503, statusText: "Service Unavailable" };
      }
      return {
        ok: true,
        jsonValue: {
          value: [{ Id: "m1", Subject: "First" }],
          "@odata.nextLink": page2Url,
        },
      };
    });

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("partial");
    expect(messages.map((message) => message.id)).toEqual(["m1"]);
    warnSpy.mockRestore();
  });

  it("reports error with no messages when the very first page fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = makeTransport(() => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    }));

    const result = await fetchConversationMessagesViaRestV2("conv-1", {
      transport,
    });

    expect(result).toEqual({ messages: [], state: "error" });
    warnSpy.mockRestore();
  });

  it("reports error instead of throwing when restUrl is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (Office.context.mailbox as unknown as MailboxMock).restUrl = undefined;
    const transport = makeTransport(() => ({ ok: true, jsonValue: {} }));

    const result = await fetchConversationMessagesViaRestV2("conv-1", {
      transport,
    });

    expect(result).toEqual({ messages: [], state: "error" });
    expect(transport).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("enriches byte-less itemAttachments via /attachments/{id}/$value best-effort", async () => {
    const transport = makeTransport((url) => {
      if (url.includes("/attachments/")) {
        return { ok: true, bytes: bytesFrom("nested-eml") };
      }
      return {
        ok: true,
        jsonValue: {
          value: [
            {
              Id: "m1",
              Subject: "Forwarded item",
              Attachments: [
                {
                  "@odata.type": "#Microsoft.OutlookServices.ItemAttachment",
                  Id: "att-1",
                  Name: "attached.msg",
                },
              ],
            },
          ],
        },
      };
    });

    const { messages } = await fetchConversationMessagesViaRestV2("conv-1", {
      transport,
    });

    const [, enrichUrl] = vi
      .mocked(transport)
      .mock.calls.map((call) => call[0]);
    expect(enrichUrl).toBe(
      `${REST_BASE}/v2.0/me/messages/${encodeURIComponent("m1")}/attachments/${encodeURIComponent("att-1")}/$value`,
    );
    expect(messages[0].attachments?.[0].contentBytes).toBe(btoa("nested-eml"));
  });

  it("leaves an itemAttachment byte-less (disclosure marker downstream) when /$value is unsupported", async () => {
    const transport = makeTransport((url) => {
      if (url.includes("/attachments/")) {
        return { ok: false, status: 404, statusText: "Not Found" };
      }
      return {
        ok: true,
        jsonValue: {
          value: [
            {
              Id: "m1",
              Subject: "Forwarded item",
              Attachments: [
                {
                  "@odata.type": "#Microsoft.OutlookServices.ItemAttachment",
                  Id: "att-1",
                  Name: "attached.msg",
                },
              ],
            },
          ],
        },
      };
    });

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("ok");
    expect(messages[0].attachments?.[0].contentBytes).toBeUndefined();
  });

  // A single forwarded item attachment, byte-less in the listing so it drives
  // the /$value enrichment path. `Retry-After: 0` makes the honored sleep
  // resolve on the next tick, so the retry runs without fake timers.
  const itemAttachmentPage = {
    ok: true as const,
    jsonValue: {
      value: [
        {
          Id: "m1",
          Subject: "Forwarded item",
          Attachments: [
            {
              "@odata.type": "#Microsoft.OutlookServices.ItemAttachment",
              Id: "att-1",
              Name: "attached.msg",
            },
          ],
        },
      ],
    },
  };

  it("retries an item-attachment /$value once on a 429 and succeeds (not degraded)", async () => {
    let attachmentAttempts = 0;
    const transport = makeTransport((url) => {
      if (url.includes("/attachments/")) {
        attachmentAttempts += 1;
        if (attachmentAttempts === 1) {
          return {
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: { "Retry-After": "0" },
          };
        }
        return { ok: true, bytes: bytesFrom("nested-eml") };
      }
      return itemAttachmentPage;
    });

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("ok");
    expect(attachmentAttempts).toBe(2);
    expect(messages[0].attachments?.[0].contentBytes).toBe(btoa("nested-eml"));
  });

  it("degrades an item-attachment to a marker after one retry when the 429 persists", async () => {
    let attachmentAttempts = 0;
    const transport = makeTransport((url) => {
      if (url.includes("/attachments/")) {
        attachmentAttempts += 1;
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Retry-After": "0" },
        };
      }
      return itemAttachmentPage;
    });

    const { messages, state } = await fetchConversationMessagesViaRestV2(
      "conv-1",
      { transport },
    );

    expect(state).toBe("ok");
    // Exactly one retry: the initial throttled attempt plus a single re-request.
    expect(attachmentAttempts).toBe(2);
    expect(messages[0].attachments?.[0].contentBytes).toBeUndefined();
  });
});
