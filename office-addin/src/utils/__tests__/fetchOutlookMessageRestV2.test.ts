import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { fetchOutlookMessageFilesViaRestV2 } from "../fetchOutlookMessageRestV2";

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  convertToRestId: ReturnType<typeof vi.fn>;
  getCallbackTokenAsync: ReturnType<typeof vi.fn>;
  restUrl?: string;
};

const EWS_ID = "AAkALgAAA-ews-id";
const REST_ID = "rest-id-converted";

function installFetchMock(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  jsonValue?: unknown;
}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    json: () => Promise.resolve(response.jsonValue ?? {}),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
  mailbox.restUrl = "https://outlook.office.com";
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
    const fetchMock = installFetchMock({
      ok: true,
      jsonValue: {
        Subject: "Test",
        Body: { ContentType: "Text", Content: "hello" },
        Attachments: [],
      },
    });

    await fetchOutlookMessageFilesViaRestV2(EWS_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://outlook.office.com/api/v2.0/me/messages/${encodeURIComponent(REST_ID)}?$expand=Attachments`,
    );
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer bearer-token-abc");
    expect(headers.Accept).toBe("application/json");
  });

  it("builds an HTML body file with rendered headers from a text-body message", async () => {
    installFetchMock({
      ok: true,
      jsonValue: {
        Subject: "Hey how are you?",
        Body: { ContentType: "Text", Content: "plain text body" },
        From: { EmailAddress: { Name: "Alice", Address: "alice@x" } },
        ToRecipients: [{ EmailAddress: { Address: "bob@x" } }],
        Attachments: [],
      },
    });

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
    installFetchMock({
      ok: true,
      jsonValue: {
        Subject: "Formatted",
        Body: { ContentType: "HTML", Content: "<p>rich</p>" },
        Attachments: [],
      },
    });

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    const html = await files[0].text();
    expect(html).toContain("<p>rich</p>");
    expect(html).not.toContain("<pre>");
  });

  it("decodes FileAttachment entries into File objects", async () => {
    const base64 = btoa("hello-pdf-bytes");
    installFetchMock({
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
    });

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    expect(files).toHaveLength(2);
    const attachment = files[1];
    expect(attachment.name).toBe("doc.pdf");
    expect(attachment.type).toBe("application/pdf");
    expect(await attachment.text()).toBe("hello-pdf-bytes");
  });

  it("skips inline attachments and non-file attachment types", async () => {
    installFetchMock({
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
    });

    const { files } = await fetchOutlookMessageFilesViaRestV2(EWS_ID);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Mixed.html");
  });

  it("throws when the REST endpoint returns a non-OK status", async () => {
    installFetchMock({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(fetchOutlookMessageFilesViaRestV2(EWS_ID)).rejects.toThrow(
      /Outlook REST fetch failed: 403 Forbidden/,
    );
  });

  it("throws when mailbox.restUrl is not available", async () => {
    const mailbox = Office.context.mailbox as unknown as {
      restUrl?: string;
    };
    mailbox.restUrl = undefined;
    installFetchMock({ ok: true });

    await expect(fetchOutlookMessageFilesViaRestV2(EWS_ID)).rejects.toThrow(
      /restUrl is not available/,
    );
  });
});
