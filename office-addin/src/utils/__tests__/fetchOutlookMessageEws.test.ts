import { tryRecoverAuth } from "@erato/frontend/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockAsyncResult } from "../../test/helpers/asyncResult";
import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import {
  EwsProxySessionExpiredError,
  EwsRequestError,
  fetchConversationMessagesViaEws,
  fetchOutlookMessageBytesByInternetMessageIdViaEws,
  fetchOutlookMessageBytesViaEws,
  fetchOutlookMessageFilesByInternetMessageIdViaEws,
  fetchParentMessageInConversationViaEws,
} from "../fetchOutlookMessageEws";

// The production module lazily imports the auth-recovery trigger from the
// shared library on the dead-session path; mock it so the test asserts the
// trigger without loading the real library bundle.
vi.mock("@erato/frontend/library", () => ({
  tryRecoverAuth: vi.fn(async () => false),
}));

type MailboxMock = ReturnType<typeof installMockMailbox> & {
  getCallbackTokenAsync: ReturnType<typeof vi.fn>;
  makeEwsRequestAsync: ReturnType<typeof vi.fn>;
  ewsUrl?: string;
  item?: { itemId?: string } | null;
};

const EWS_ID = "AAkALgAAA-ews-item-id";
const EWS_URL = "https://exchange.example.com/EWS/Exchange.asmx";
const CRLF = "\r\n";

const SOAP_OPEN =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" ' +
  'xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">' +
  "<s:Body>";
const SOAP_CLOSE = "</s:Body></s:Envelope>";

function soap(body: string): string {
  return SOAP_OPEN + body + SOAP_CLOSE;
}

/** Escape values interpolated into element text in the fixtures (the real
 * server emits escaped text, e.g. `<abc@host>` → `&lt;abc@host&gt;`). */
function xe(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface MockResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  /** The XML text body the production code parses via DOMParser. */
  xml?: string;
}

/**
 * EWS uses a single SOAP POST per request, so responses are keyed off the
 * operation name found in the request body the production code sends.
 */
function installFetchMock(
  responder: (soapBody: string, init?: RequestInit) => MockResponse,
) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const response = responder(String(init?.body ?? ""), init);
    return {
      ok: response.ok,
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      text: () => Promise.resolve(response.xml ?? soap("")),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function installOutlookMailboxMock(): MailboxMock {
  const mailbox = installMockMailbox() as MailboxMock;
  mailbox.getCallbackTokenAsync = vi.fn((_options, callback) => {
    callback(createMockAsyncResult("ews-token-abc"));
  });
  // The host transport (makeEwsRequestAsync) is opt-in per test: the default
  // surfaces an EWS error so a test that forgets to wire it fails loudly rather
  // than silently. Conversation/FindItem tests install their own via
  // `installHostMock`.
  mailbox.makeEwsRequestAsync = vi.fn(
    (_data: string, callback: (result: HostAsyncResult) => void) => {
      callback({
        status: "failed",
        error: { code: 0, message: "makeEwsRequestAsync not mocked" },
      });
    },
  );
  mailbox.ewsUrl = EWS_URL;
  return mailbox;
}

/** Shape of the `asyncResult` the host transport's callback receives. Mirrors
 * `Office.AsyncResult<string>`: `status` is the string-valued
 * `Office.AsyncResultStatus` (the setup stub maps Succeeded→"succeeded",
 * Failed→"failed"); the cap surfaces as `{ code: 9020, message: "…1 MB…" }`. */
interface HostAsyncResult {
  status: "succeeded" | "failed";
  value?: string;
  error?: { code: number; message: string };
}

/**
 * Installs the host transport mock (`makeEwsRequestAsync`). Like
 * `installFetchMock`, responses are keyed off the operation name in the SOAP
 * body the production code passes as the first argument.
 */
function installHostMock(
  responder: (soapBody: string) => HostAsyncResult,
): ReturnType<typeof vi.fn> {
  const hostMock = vi.fn(
    (data: string, callback: (result: HostAsyncResult) => void) => {
      callback(responder(String(data ?? "")));
    },
  );
  (Office.context.mailbox as unknown as MailboxMock).makeEwsRequestAsync =
    hostMock;
  return hostMock;
}

/** Sets the currently-selected item id (the one the DIRECT path can fetch). */
function setCurrentItem(itemId: string | undefined): void {
  (Office.context.mailbox as unknown as MailboxMock).item = itemId
    ? { itemId }
    : null;
}

function getItemMimeResponse(opts: {
  subject?: string;
  internetMessageId?: string;
  mimeBase64: string;
}): string {
  return soap(
    "<m:GetItemResponse><m:ResponseMessages>" +
      '<m:GetItemResponseMessage ResponseClass="Success">' +
      "<m:ResponseCode>NoError</m:ResponseCode>" +
      "<m:Items><t:Message>" +
      '<t:ItemId Id="item-1"/>' +
      `<t:MimeContent CharacterSet="UTF-8">${opts.mimeBase64}</t:MimeContent>` +
      (opts.subject ? `<t:Subject>${xe(opts.subject)}</t:Subject>` : "") +
      (opts.internetMessageId
        ? `<t:InternetMessageId>${xe(opts.internetMessageId)}</t:InternetMessageId>`
        : "") +
      "</t:Message></m:Items>" +
      "</m:GetItemResponseMessage>" +
      "</m:ResponseMessages></m:GetItemResponse>",
  );
}

describe("fetchOutlookMessageBytesViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
    vi.mocked(tryRecoverAuth).mockClear();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  it("POSTs a GetItem with IncludeMimeContent and base64-decodes the MIME", async () => {
    const mimeBase64 = btoa("raw-mime-bytes");
    const fetchMock = installFetchMock(() => ({
      ok: true,
      xml: getItemMimeResponse({
        subject: "Test",
        internetMessageId: "<abc@host>",
        mimeBase64,
      }),
    }));

    const result = await fetchOutlookMessageBytesViaEws(EWS_ID);

    expect(result.subject).toBe("Test");
    expect(result.internetMessageId).toBe("<abc@host>");
    expect(new TextDecoder().decode(result.bytes)).toBe("raw-mime-bytes");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // Posts to the same-origin Erato EWS proxy, NOT the cross-origin ewsUrl.
    expect(url).toBe("/api/v1beta/integrations/ms-office/ews");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    // Callback token rides X-EWS-Authentication (the proxy re-maps it onto
    // Exchange's Authorization); the Erato session authenticates the proxy via
    // the cookie. No client-sent target URL — the backend derives it from config.
    expect(headers["X-EWS-Authentication"]).toBe("Bearer ews-token-abc");
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-MS-EWS-Url"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("text/xml; charset=utf-8");
    expect((init as RequestInit).credentials).toBe("include");

    const body = String((init as RequestInit).body);
    expect(body).toContain("<m:GetItem>");
    expect(body).toContain("<t:IncludeMimeContent>true</t:IncludeMimeContent>");
    expect(body).toContain(
      '<t:RequestServerVersion Version="Exchange2013_SP1"/>',
    );
    expect(body).toContain(`<t:ItemId Id="${EWS_ID}"/>`);
  });

  it("throws a typed error on a SOAP Fault", async () => {
    installFetchMock(() => ({
      ok: true,
      xml:
        '<?xml version="1.0"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
        "<s:Body><s:Fault>" +
        "<faultcode>s:Client</faultcode>" +
        "<faultstring>Invalid request</faultstring>" +
        "</s:Fault></s:Body></s:Envelope>",
    }));

    await expect(fetchOutlookMessageBytesViaEws(EWS_ID)).rejects.toThrow(
      /SOAP fault: Invalid request/,
    );
  });

  it("throws a typed error on an EWS ResponseClass=Error", async () => {
    installFetchMock(() => ({
      ok: true,
      xml: soap(
        "<m:GetItemResponse><m:ResponseMessages>" +
          '<m:GetItemResponseMessage ResponseClass="Error">' +
          "<m:ResponseCode>ErrorAccessDenied</m:ResponseCode>" +
          "<m:MessageText>Access is denied.</m:MessageText>" +
          "</m:GetItemResponseMessage>" +
          "</m:ResponseMessages></m:GetItemResponse>",
      ),
    }));

    await expect(fetchOutlookMessageBytesViaEws(EWS_ID)).rejects.toThrow(
      /Access is denied/,
    );
  });

  it("re-acquires the callback token and retries once on a 401", async () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    let tokenIndex = 0;
    mailbox.getCallbackTokenAsync = vi.fn((_options, callback) => {
      tokenIndex += 1;
      callback(createMockAsyncResult(`token-${tokenIndex}`));
    });
    const fetchMock = installFetchMock((_body, init) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.[
        "X-EWS-Authentication"
      ];
      // The first attempt carries the expired cached token and is rejected.
      if (auth === "Bearer token-1") {
        return { ok: false, status: 401, statusText: "Unauthorized" };
      }
      return {
        ok: true,
        xml: getItemMimeResponse({
          subject: "Recovered",
          mimeBase64: btoa("x"),
        }),
      };
    });

    const result = await fetchOutlookMessageBytesViaEws(EWS_ID);

    expect(result.subject).toBe("Recovered");
    expect(mailbox.getCallbackTokenAsync).toHaveBeenCalledTimes(2);
    const sentTokens = fetchMock.mock.calls.map(
      (call) =>
        ((call[1] as RequestInit).headers as Record<string, string>)[
          "X-EWS-Authentication"
        ],
    );
    expect(sentTokens).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("surfaces a dead oauth2-proxy session as EwsProxySessionExpiredError after exactly one token refresh (persistent 401)", async () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    // The EWS proxy 401s persistently AND the /oauth2/auth probe 401s too:
    // the Erato session (not the callback token) has expired.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchOutlookMessageBytesViaEws(EWS_ID).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(EwsProxySessionExpiredError);
    expect(String(error)).toMatch(/sign-in required/);
    // Exactly ONE refresh: the initial acquisition plus the single 401-driven
    // re-acquisition — never a refresh loop.
    expect(mailbox.getCallbackTokenAsync).toHaveBeenCalledTimes(2);
    // Two EWS attempts (initial + one retry), then ONE disambiguation probe
    // against the proxy auth endpoint, carrying the session cookie.
    expect(
      fetchMock.mock.calls.filter(
        (call) => call[0] === "/api/v1beta/integrations/ms-office/ews",
      ),
    ).toHaveLength(2);
    const probeCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/oauth2/auth",
    );
    expect(probeCalls).toHaveLength(1);
    expect((probeCalls[0][1] as RequestInit).credentials).toBe("include");
    // The shared auth-recovery trigger fired exactly once (fire-and-forget,
    // before the throw), so the login provider's handler re-probes and flips
    // the UI to the sign-in CTA even though this caller only sees the error.
    await vi.waitFor(() => {
      expect(tryRecoverAuth).toHaveBeenCalledTimes(1);
    });
    expect(tryRecoverAuth).toHaveBeenCalledWith("ews-401");
  });

  it("keeps a persistent 401 with a LIVE oauth2-proxy session as a plain EwsRequestError (callback token rejected)", async () => {
    const mailbox = Office.context.mailbox as unknown as MailboxMock;
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/oauth2/auth") {
        // The proxy session is alive — the 401s are Exchange's.
        return {
          ok: true,
          status: 202,
          statusText: "Accepted",
          text: () => Promise.resolve(""),
        } as Response;
      }
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const error = await fetchOutlookMessageBytesViaEws(EWS_ID).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(EwsRequestError);
    expect(error).not.toBeInstanceOf(EwsProxySessionExpiredError);
    expect(String(error)).toMatch(/401/);
    expect(mailbox.getCallbackTokenAsync).toHaveBeenCalledTimes(2);
    // A live session is not a recovery case — the trigger must not fire.
    // (Flush the would-be fire-and-forget chain before asserting.)
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tryRecoverAuth).not.toHaveBeenCalled();
  });

  it("rethrows the abort reason after the second 401 without probing the session or firing recovery", async () => {
    const controller = new AbortController();
    const reason = new Error("caller timed out");
    let ewsCalls = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      ewsCalls += 1;
      if (ewsCalls === 2) {
        // The abort fires while the retried request is in flight; its 401
        // response still lands.
        controller.abort(reason);
      }
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOutlookMessageBytesViaEws(EWS_ID, { signal: controller.signal }),
    ).rejects.toBe(reason);

    // The disambiguation probe was never spent on an aborted operation.
    expect(
      fetchMock.mock.calls.some((call) => call[0] === "/oauth2/auth"),
    ).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tryRecoverAuth).not.toHaveBeenCalled();
  });

  it("propagates an abort that lands mid-probe (signal threaded into the probe, no recovery fired)", async () => {
    const controller = new AbortController();
    const reason = new Error("torn down mid-probe");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/oauth2/auth") {
        // The caller's signal must be threaded into the probe request so it
        // can actually be cancelled. Simulate fetch's abort behavior: the
        // signal fires while the probe is in flight and the request rejects
        // with the abort reason.
        expect((init as RequestInit).signal).toBe(controller.signal);
        controller.abort(reason);
        throw reason;
      }
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOutlookMessageBytesViaEws(EWS_ID, { signal: controller.signal }),
    ).rejects.toBe(reason);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tryRecoverAuth).not.toHaveBeenCalled();
  });

  it("throws a typed 'not valid XML' error when the proxy answers with an HTML login page", async () => {
    // A 200 HTML page (e.g. an oauth2-proxy sign-in page reached through a
    // redirect) must surface as the typed parse error, not a downstream crash.
    installFetchMock(() => ({
      ok: true,
      xml:
        "<!DOCTYPE html><html><head>" +
        '<meta charset="utf-8"><title>Sign in</title>' +
        "</head><body>login</body></html>",
    }));

    const error = await fetchOutlookMessageBytesViaEws(EWS_ID).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(EwsRequestError);
    expect(String(error)).toMatch(/not valid XML/);
  });

  it("throws when ewsUrl is unavailable", async () => {
    (Office.context.mailbox as unknown as MailboxMock).ewsUrl = undefined;
    installFetchMock(() => ({ ok: true }));

    await expect(fetchOutlookMessageBytesViaEws(EWS_ID)).rejects.toThrow(
      /ewsUrl is not available/,
    );
  });
});

describe("fetchOutlookMessageFilesByInternetMessageIdViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  /** One per-folder FindItemResponseMessage with zero or one matched item —
   * EWS answers a multi-folder FindItem with one of these PER searched folder. */
  function folderMatch(itemId: string | null): string {
    const item = itemId
      ? `<t:Items><t:Message><t:ItemId Id="${itemId}"/></t:Message></t:Items>`
      : "<t:Items/>";
    return (
      '<m:FindItemResponseMessage ResponseClass="Success">' +
      "<m:ResponseCode>NoError</m:ResponseCode>" +
      `<m:RootFolder>${item}</m:RootFolder>` +
      "</m:FindItemResponseMessage>"
    );
  }

  /** A per-folder error response message (e.g. one folder ErrorAccessDenied
   * while the others answer normally). */
  function folderError(code: string): string {
    return (
      '<m:FindItemResponseMessage ResponseClass="Error">' +
      `<m:ResponseCode>${code}</m:ResponseCode>` +
      `<m:MessageText>${code}</m:MessageText>` +
      "</m:FindItemResponseMessage>"
    );
  }

  function findItemResponseOf(...responseMessages: string[]): string {
    return soap(
      "<m:FindItemResponse><m:ResponseMessages>" +
        responseMessages.join("") +
        "</m:ResponseMessages></m:FindItemResponse>",
    );
  }

  function findItemResponse(itemId: string | null): string {
    return findItemResponseOf(folderMatch(itemId));
  }

  it("FindItem (host) restricts on InternetMessageId then GetItem (host) resolves the MIME", async () => {
    // The matched id is NOT the current item, so BOTH the mailbox-wide FindItem
    // and the resolved GetItem go through the HOST transport.
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:FindItem")) {
        return { status: "succeeded", value: findItemResponse("matched-id") };
      }
      return {
        status: "succeeded",
        value: getItemMimeResponse({
          subject: "Matched",
          internetMessageId: "<abc@host>",
          mimeBase64: btoa("raw"),
        }),
      };
    });

    const result =
      await fetchOutlookMessageFilesByInternetMessageIdViaEws("<abc@host>");

    expect(result).not.toBeNull();
    expect(result?.subject).toBe("Matched");
    expect(result?.internetMessageId).toBe("<abc@host>");
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0].type).toBe("message/rfc822");
    expect(result?.files[0].name).toBe("Matched.eml");

    const findBody = String(hostMock.mock.calls[0][0] ?? "");
    // makeEwsRequestAsync rejects a UTF-8 XML declaration — the host leg must
    // strip it (the direct/proxy leg keeps it).
    expect(findBody).not.toContain("<?xml");
    expect(findBody).not.toContain("encoding=");
    expect(findBody.startsWith("<soap:Envelope")).toBe(true);
    expect(findBody).toContain('<m:FindItem Traversal="Shallow">');
    expect(findBody).toContain('PropertyTag="0x1035"');
    // The restriction value is XML-escaped into the attribute.
    expect(findBody).toContain('<t:Constant Value="&lt;abc@host&gt;"/>');
    // FindItem searches the well-known mail folders in ONE request — and never
    // "root" (the Non-IPM subtree, which holds no mail, so a FindItem against
    // it always came back empty).
    expect(findBody).toContain(
      "<m:ParentFolderIds>" +
        '<t:DistinguishedFolderId Id="inbox"/>' +
        '<t:DistinguishedFolderId Id="sentitems"/>' +
        '<t:DistinguishedFolderId Id="drafts"/>' +
        '<t:DistinguishedFolderId Id="deleteditems"/>' +
        '<t:DistinguishedFolderId Id="junkemail"/>' +
        "</m:ParentFolderIds>",
    );
    expect(findBody).not.toContain('Id="root"');

    const getBody = String(hostMock.mock.calls[1][0] ?? "");
    expect(getBody).toContain('<t:ItemId Id="matched-id"/>');
  });

  it("finds a match that sits in the SECOND folder's response message (one FindItemResponseMessage per searched folder)", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:FindItem")) {
        // inbox missed; sentitems holds the match; the rest missed too.
        return {
          status: "succeeded",
          value: findItemResponseOf(
            folderMatch(null),
            folderMatch("in-sentitems"),
            folderMatch(null),
            folderMatch(null),
            folderMatch(null),
          ),
        };
      }
      return {
        status: "succeeded",
        value: getItemMimeResponse({
          subject: "From Sent",
          mimeBase64: btoa("x"),
        }),
      };
    });

    const result =
      await fetchOutlookMessageBytesByInternetMessageIdViaEws("<abc@host>");

    expect(result?.subject).toBe("From Sent");
    const getBody = String(hostMock.mock.calls[1][0] ?? "");
    expect(getBody).toContain('<t:ItemId Id="in-sentitems"/>');
  });

  it("tolerates one folder erroring (ErrorAccessDenied) while another folder matches — and warns about the swallowed error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:FindItem")) {
        return {
          status: "succeeded",
          value: findItemResponseOf(
            folderError("ErrorAccessDenied"),
            folderMatch("matched-id"),
            folderMatch(null),
          ),
        };
      }
      return {
        status: "succeeded",
        value: getItemMimeResponse({
          subject: "Survived",
          mimeBase64: btoa("x"),
        }),
      };
    });

    const result =
      await fetchOutlookMessageBytesByInternetMessageIdViaEws("<abc@host>");

    expect(result?.subject).toBe("Survived");
    const getBody = String(hostMock.mock.calls[1][0] ?? "");
    expect(getBody).toContain('<t:ItemId Id="matched-id"/>');
    // The swallowed per-folder error is disclosed (count + first ResponseCode)
    // rather than disappearing silently.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /swallowed 1 hard-errored folder.*ErrorAccessDenied/,
      ),
    );
    warnSpy.mockRestore();
  });

  it("throws when EVERY folder's response message errors hard (the lookup itself failed)", async () => {
    installHostMock(() => ({
      status: "succeeded",
      value: findItemResponseOf(
        folderError("ErrorAccessDenied"),
        folderError("ErrorAccessDenied"),
      ),
    }));

    await expect(
      fetchOutlookMessageBytesByInternetMessageIdViaEws("<abc@host>"),
    ).rejects.toThrow(/ErrorAccessDenied/);
  });

  it("throws (not a clean miss) when no folder matched and one folder hard-errored — the message may sit in exactly that folder", async () => {
    installHostMock(() => ({
      status: "succeeded",
      value: findItemResponseOf(
        folderMatch(null),
        folderError("ErrorAccessDenied"),
        // A tolerated per-folder miss must not mask the hard error.
        folderError("ErrorItemNotFound"),
        folderMatch(null),
      ),
    }));

    await expect(
      fetchOutlookMessageBytesByInternetMessageIdViaEws("<abc@host>"),
    ).rejects.toThrow(/ErrorAccessDenied/);
  });

  it("fetches the matched message via the DIRECT path when it is the current item", async () => {
    setCurrentItem("matched-id");
    // FindItem still goes via the host (mailbox-wide); the resolved GetItem,
    // being the current item, goes DIRECT (the proxy POST) instead.
    const hostMock = installHostMock(() => ({
      status: "succeeded",
      value: findItemResponse("matched-id"),
    }));
    const fetchMock = installFetchMock((body) => {
      expect(body).toContain('<t:ItemId Id="matched-id"/>');
      return {
        ok: true,
        xml: getItemMimeResponse({ subject: "Current", mimeBase64: btoa("x") }),
      };
    });

    const result =
      await fetchOutlookMessageBytesByInternetMessageIdViaEws("<abc@host>");

    expect(result?.subject).toBe("Current");
    // FindItem on host, GetItem on the proxy.
    expect(hostMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1beta/integrations/ms-office/ews",
    );
  });

  it("returns null when FindItem yields no match", async () => {
    installHostMock(() => ({
      status: "succeeded",
      value: findItemResponse(null),
    }));

    const result =
      await fetchOutlookMessageBytesByInternetMessageIdViaEws("<missing@host>");

    expect(result).toBeNull();
  });

  it("returns null on ErrorItemNotFound (clean miss, not a failure)", async () => {
    installHostMock(() => ({
      status: "succeeded",
      value: soap(
        "<m:FindItemResponse><m:ResponseMessages>" +
          '<m:FindItemResponseMessage ResponseClass="Error">' +
          "<m:ResponseCode>ErrorItemNotFound</m:ResponseCode>" +
          "</m:FindItemResponseMessage>" +
          "</m:ResponseMessages></m:FindItemResponse>",
      ),
    }));

    const result =
      await fetchOutlookMessageBytesByInternetMessageIdViaEws("<gone@host>");

    expect(result).toBeNull();
  });

  it("escapes XML-significant characters in the restriction value", async () => {
    const hostMock = installHostMock(() => ({
      status: "succeeded",
      value: findItemResponse(null),
    }));

    await fetchOutlookMessageBytesByInternetMessageIdViaEws("<a&b@host>");

    const body = String(hostMock.mock.calls[0][0] ?? "");
    expect(body).toContain('<t:Constant Value="&lt;a&amp;b@host&gt;"/>');
  });
});

describe("fetchConversationMessagesViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  function conversationItemsResponse(itemIds: string[]): string {
    const nodes = itemIds
      .map(
        (id) =>
          "<t:ConversationNode><t:Items>" +
          `<t:Message><t:ItemId Id="${id}"/></t:Message>` +
          "</t:Items></t:ConversationNode>",
      )
      .join("");
    return soap(
      "<m:GetConversationItemsResponse><m:ResponseMessages>" +
        '<m:GetConversationItemsResponseMessage ResponseClass="Success">' +
        "<m:ResponseCode>NoError</m:ResponseCode>" +
        `<m:Conversation><t:ConversationNodes>${nodes}</t:ConversationNodes></m:Conversation>` +
        "</m:GetConversationItemsResponseMessage>" +
        "</m:ResponseMessages></m:GetConversationItemsResponse>",
    );
  }

  function messageItemResponse(opts: {
    itemId: string;
    subject: string;
    bodyType?: "HTML" | "Text";
    body?: string;
    fromName?: string;
    fromAddress?: string;
    received?: string;
    isDraft?: boolean;
    attachmentsXml?: string;
  }): string {
    return soap(
      "<m:GetItemResponse><m:ResponseMessages>" +
        '<m:GetItemResponseMessage ResponseClass="Success">' +
        "<m:ResponseCode>NoError</m:ResponseCode>" +
        "<m:Items><t:Message>" +
        `<t:ItemId Id="${opts.itemId}"/>` +
        `<t:Subject>${opts.subject}</t:Subject>` +
        `<t:Body BodyType="${opts.bodyType ?? "HTML"}">${opts.body ?? ""}</t:Body>` +
        (opts.received
          ? `<t:DateTimeReceived>${opts.received}</t:DateTimeReceived>`
          : "") +
        `<t:IsDraft>${opts.isDraft ? "true" : "false"}</t:IsDraft>` +
        (opts.fromName || opts.fromAddress
          ? "<t:From><t:Mailbox>" +
            (opts.fromName ? `<t:Name>${opts.fromName}</t:Name>` : "") +
            (opts.fromAddress
              ? `<t:EmailAddress>${opts.fromAddress}</t:EmailAddress>`
              : "") +
            "</t:Mailbox></t:From>"
          : "") +
        (opts.attachmentsXml ?? "") +
        "</t:Message></m:Items>" +
        "</m:GetItemResponseMessage>" +
        "</m:ResponseMessages></m:GetItemResponse>",
    );
  }

  /**
   * A tiny valid RFC822 MIME with one base64-encoded attachment part, for
   * postal-mime to parse during attachment enrichment (the enrichment fetches
   * the OWNING MESSAGE's MIME via GetItem + IncludeMimeContent — there is no
   * GetAttachment anymore). `parts` lets a caller add more attachment parts
   * (e.g. an inline part with a Content-ID).
   */
  function mimeWithAttachment(opts: {
    filename: string;
    mimeType: string;
    bytes: string;
    contentId?: string;
    extraParts?: string;
  }): string {
    const boundary = "----EWS-MIME-BOUNDARY";
    return (
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: With attachment${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}` +
      `${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      `see attached${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Type: ${opts.mimeType}; name="${opts.filename}"${CRLF}` +
      `Content-Disposition: attachment; filename="${opts.filename}"${CRLF}` +
      (opts.contentId ? `Content-ID: <${opts.contentId}>${CRLF}` : "") +
      `Content-Transfer-Encoding: base64${CRLF}` +
      `${CRLF}` +
      `${btoa(opts.bytes)}${CRLF}` +
      (opts.extraParts ?? "") +
      `--${boundary}--${CRLF}`
    );
  }

  /** A GetItem + IncludeMimeContent response carrying a message's full RFC822
   * MIME as base64 in <t:MimeContent> — what attachment enrichment fetches. */
  function getItemMimeContentResponse(mimeText: string): string {
    return soap(
      "<m:GetItemResponse><m:ResponseMessages>" +
        '<m:GetItemResponseMessage ResponseClass="Success">' +
        "<m:ResponseCode>NoError</m:ResponseCode>" +
        "<m:Items><t:Message>" +
        '<t:ItemId Id="item-mime"/>' +
        `<t:MimeContent CharacterSet="UTF-8">${btoa(mimeText)}</t:MimeContent>` +
        "</t:Message></m:Items>" +
        "</m:GetItemResponseMessage>" +
        "</m:ResponseMessages></m:GetItemResponse>",
    );
  }

  /** Distinguishes the attachment-enrichment GetItem (IncludeMimeContent) from
   * the body-shape GetItem the conversation phase sends. */
  function isMimeGetItem(body: string): boolean {
    return (
      body.includes("<m:GetItem>") &&
      body.includes("<t:IncludeMimeContent>true</t:IncludeMimeContent>")
    );
  }

  it("HYBRID: enumerates + sibling GetItems via the host, current item via the direct proxy", async () => {
    // m2 is the currently-selected item → it must be fetched via window.fetch
    // (the direct proxy, no cap). m1 and m3 are siblings → host transport.
    setCurrentItem("m2");
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1", "m2", "m3"]),
        };
      }
      if (body.includes('<t:ItemId Id="m1"/>')) {
        return {
          status: "succeeded",
          value: messageItemResponse({
            itemId: "m1",
            subject: "Kickoff",
            bodyType: "HTML",
            body: "&lt;p&gt;hello&lt;/p&gt;",
            fromName: "Alice",
            fromAddress: "alice@x",
            received: "2026-03-01T10:00:00Z",
          }),
        };
      }
      // m3 sibling.
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m3",
          subject: "Later reply",
          bodyType: "Text",
          body: "ok",
          received: "2026-03-03T10:00:00Z",
        }),
      };
    });
    // The direct proxy serves ONLY the current item (m2).
    const fetchMock = installFetchMock((body) => {
      expect(body).toContain('<t:ItemId Id="m2"/>');
      return {
        ok: true,
        xml: messageItemResponse({
          itemId: "m2",
          subject: "Reply",
          bodyType: "Text",
          body: "thanks",
          fromName: "Bob",
          fromAddress: "bob@x",
          received: "2026-03-02T10:00:00Z",
        }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    expect(state).toBe("ok");
    // Enumeration went through the host.
    const convBody = String(hostMock.mock.calls[0][0] ?? "");
    expect(convBody).toContain("<m:GetConversationItems>");
    expect(convBody).toContain('<t:ConversationId Id="conv-1"/>');
    // The current item (m2) went through the direct proxy POST, NOT the host.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1beta/integrations/ms-office/ews",
    );
    // The host served the enumeration plus the two siblings (m1, m3), never m2.
    const hostGetItemIds = hostMock.mock.calls
      .map((call) => String(call[0] ?? ""))
      .filter((b) => b.includes("<m:GetItem>"))
      .map((b) => b.match(/<t:ItemId Id="([^"]+)"\/>/)?.[1]);
    expect(hostGetItemIds.sort()).toEqual(["m1", "m3"]);

    expect(messages).toHaveLength(3);
    const byId = Object.fromEntries(messages.map((m) => [m.id, m]));
    expect(byId.m1.subject).toBe("Kickoff");
    expect(byId.m1.body).toEqual({
      contentType: "html",
      content: "<p>hello</p>",
    });
    expect(byId.m1.from).toEqual({
      emailAddress: { name: "Alice", address: "alice@x" },
    });
    expect(byId.m2.subject).toBe("Reply");
    expect(byId.m2.body).toEqual({ contentType: "text", content: "thanks" });
    expect(byId.m3.subject).toBe("Later reply");
  });

  it("degrades a sibling whose host GetItem hits the ~1 MB cap to a body-less marker (partial)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // No current item: both members are siblings served by the host. m2's host
    // GetItem hits the 9020 / size cap → it degrades, the thread stays partial.
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1", "m2"]),
        };
      }
      if (body.includes('<t:ItemId Id="m2"/>')) {
        return {
          status: "failed",
          error: { code: 9020, message: "Response exceeds 1 MB size limit" },
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({ itemId: "m1", subject: "Survives" }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    expect(state).toBe("partial");
    // The oversized sibling stays in the thread as a body-less marker (just its
    // id), so the conversation structure is preserved; m1 keeps its body.
    const byId = Object.fromEntries(messages.map((m) => [m.id, m]));
    expect(messages.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
    expect(byId.m1.subject).toBe("Survives");
    expect(byId.m2.subject).toBeUndefined();
    expect(byId.m2.body).toBeUndefined();
    expect(hostMock).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("reports error when GetConversationItems comes back ErrorAccessDenied (host also restricted)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Both the GetConversationItems and the FindItem fallback are ErrorAccessDenied
    // — the host path is restricted on this box, so the fetch degrades to error.
    const hostMock = installHostMock(() => ({
      status: "failed",
      error: {
        code: 0,
        message:
          "The requested web method is unavailable to this caller or application.",
      },
    }));

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    expect(hostMock).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to FindItem ConversationId restriction (host) when GetConversationItems errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Error">' +
              "<m:ResponseCode>ErrorInvalidIdMalformed</m:ResponseCode>" +
              "<m:MessageText>Id is malformed.</m:MessageText>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      if (body.includes("<m:FindItem")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:FindItemResponse><m:ResponseMessages>" +
              '<m:FindItemResponseMessage ResponseClass="Success">' +
              "<m:ResponseCode>NoError</m:ResponseCode>" +
              "<m:RootFolder><t:Items>" +
              '<t:Message><t:ItemId Id="m1"/></t:Message>' +
              "</t:Items></m:RootFolder>" +
              "</m:FindItemResponseMessage>" +
              "</m:ResponseMessages></m:FindItemResponse>",
          ),
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Found via FindItem",
        }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    expect(state).toBe("ok");
    expect(messages.map((m) => m.id)).toEqual(["m1"]);
    const findBody = hostMock.mock.calls
      .map((call) => String(call[0] ?? ""))
      .find((body) => body.includes("<m:FindItem"));
    expect(findBody).toContain('<m:FindItem Traversal="Shallow">');
    expect(findBody).toContain('<t:FieldURI FieldURI="item:ConversationId"/>');
    // Searches the well-known mail folders, never the mail-less "root".
    expect(findBody).toContain('<t:DistinguishedFolderId Id="inbox"/>');
    expect(findBody).toContain('<t:DistinguishedFolderId Id="sentitems"/>');
    expect(findBody).not.toContain('Id="root"');
    warnSpy.mockRestore();
  });

  it("reports error when the enumeration itself fails (GetConversationItems + FindItem)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock(() => ({
      status: "failed",
      error: { code: 0, message: "Bad Request" },
    }));

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    warnSpy.mockRestore();
  });

  it("reports error (not a clean empty thread) when the FindItem fallback matches nothing and a folder hard-errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // GetConversationItems rejects the id; the FindItem fallback sees every
    // folder empty except one ErrorAccessDenied. The conversation may live in
    // exactly that unreadable folder, so the fetch must degrade to `error`
    // (state contract), never an unhandled rejection or a silent "no thread".
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Error">' +
              "<m:ResponseCode>ErrorInvalidIdMalformed</m:ResponseCode>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      return {
        status: "succeeded",
        value: soap(
          "<m:FindItemResponse><m:ResponseMessages>" +
            '<m:FindItemResponseMessage ResponseClass="Success">' +
            "<m:ResponseCode>NoError</m:ResponseCode>" +
            "<m:RootFolder><t:Items/></m:RootFolder>" +
            "</m:FindItemResponseMessage>" +
            '<m:FindItemResponseMessage ResponseClass="Error">' +
            "<m:ResponseCode>ErrorAccessDenied</m:ResponseCode>" +
            "<m:MessageText>Access is denied.</m:MessageText>" +
            "</m:FindItemResponseMessage>" +
            "</m:ResponseMessages></m:FindItemResponse>",
        ),
      };
    });

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    warnSpy.mockRestore();
  });

  it("reports error (never an empty ok) when the enumeration yields zero members", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // GetConversationItems rejects the id; the FindItem fallback succeeds but
    // matches nothing in any folder. The current item is by definition a
    // member of its own conversation, so zero members is always a failure —
    // not a real empty thread.
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Error">' +
              "<m:ResponseCode>ErrorInvalidIdMalformed</m:ResponseCode>" +
              "<m:MessageText>Id is malformed.</m:MessageText>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      // Every searched folder comes back empty.
      return {
        status: "succeeded",
        value: soap(
          "<m:FindItemResponse><m:ResponseMessages>" +
            '<m:FindItemResponseMessage ResponseClass="Success">' +
            "<m:ResponseCode>NoError</m:ResponseCode>" +
            "<m:RootFolder><t:Items/></m:RootFolder>" +
            "</m:FindItemResponseMessage>" +
            "</m:ResponseMessages></m:FindItemResponse>",
        ),
      };
    });

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    warnSpy.mockRestore();
  });

  it("rethrows the abort reason instead of reporting state error when the signal is aborted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock(() => ({
      status: "failed",
      error: { code: 0, message: "request torn down mid-flight" },
    }));
    const controller = new AbortController();
    const reason = new Error("user navigated away");
    controller.abort(reason);

    await expect(
      fetchConversationMessagesViaEws("conv-1", { signal: controller.signal }),
    ).rejects.toBe(reason);
    warnSpy.mockRestore();
  });

  it("reports error instead of throwing when ewsUrl is unavailable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (Office.context.mailbox as unknown as MailboxMock).ewsUrl = undefined;
    const hostMock = installHostMock(() => ({
      status: "succeeded",
      value: soap(""),
    }));

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    expect(hostMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("maps a sibling FileAttachment's inline Content as base64 contentBytes (host)", async () => {
    const attachmentsXml =
      "<t:Attachments><t:FileAttachment>" +
      '<t:AttachmentId Id="att-1"/>' +
      "<t:Name>doc.pdf</t:Name>" +
      "<t:ContentType>application/pdf</t:ContentType>" +
      "<t:Size>7</t:Size>" +
      "<t:IsInline>false</t:IsInline>" +
      `<t:Content>${btoa("pdf-doc")}</t:Content>` +
      "</t:FileAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "With attachment",
          attachmentsXml,
        }),
      };
    });

    const { messages } = await fetchConversationMessagesViaEws("conv-1");

    expect(messages[0].attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        id: "att-1",
        name: "doc.pdf",
        contentType: "application/pdf",
        size: 7,
        isInline: false,
        contentBytes: btoa("pdf-doc"),
        contentId: undefined,
      },
    ]);
  });

  it("enriches a sibling's byte-less FileAttachment from the owning message's MIME (host GetItem IncludeMimeContent, never GetAttachment)", async () => {
    // GetItem (body shape) returns attachment METADATA only (no <t:Content>) —
    // as real EWS does. Bytes are spliced from the owning message's MIME, fetched
    // via a SECOND GetItem with IncludeMimeContent (NOT GetAttachment, which the
    // host transport does not permit).
    const attachmentsXml =
      "<t:Attachments><t:FileAttachment>" +
      '<t:AttachmentId Id="att-pdf"/>' +
      "<t:Name>AIRR-Parts.pdf</t:Name>" +
      "<t:ContentType>application/pdf</t:ContentType>" +
      "<t:Size>3000000</t:Size>" +
      "<t:IsInline>false</t:IsInline>" +
      "</t:FileAttachment></t:Attachments>";
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      // The enrichment GetItem (IncludeMimeContent) → return the message MIME
      // whose body carries the PDF as a base64 attachment part.
      if (isMimeGetItem(body)) {
        return {
          status: "succeeded",
          value: getItemMimeContentResponse(
            mimeWithAttachment({
              filename: "AIRR-Parts.pdf",
              mimeType: "application/pdf",
              bytes: "real-pdf-bytes",
            }),
          ),
        };
      }
      // The body-shape GetItem (m1).
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "With PDF",
          attachmentsXml,
        }),
      };
    });

    const { messages } = await fetchConversationMessagesViaEws("conv-1");

    const attachment = messages[0].attachments?.[0];
    expect(attachment?.["@odata.type"]).toBe("#microsoft.graph.fileAttachment");
    expect(attachment?.name).toBe("AIRR-Parts.pdf");
    expect(attachment?.contentBytes).toBe(btoa("real-pdf-bytes"));
    // The host served a GetItem with IncludeMimeContent for the bytes — and NEVER
    // a GetAttachment (it isn't permitted through makeEwsRequestAsync).
    const hostBodies = hostMock.mock.calls.map((c) => String(c[0] ?? ""));
    expect(hostBodies.some(isMimeGetItem)).toBe(true);
    expect(hostBodies.some((b) => b.includes("<m:GetAttachment>"))).toBe(false);
  });

  it("enriches the CURRENT item's byte-less FileAttachment via the DIRECT MIME GetItem (the big-PDF path, no cap)", async () => {
    // The current item routes the enrichment GetItem-MIME through the DIRECT proxy
    // (no host cap), so a 3 MB PDF on the selected message comes through whole.
    setCurrentItem("m1");
    const attachmentsXml =
      "<t:Attachments><t:FileAttachment>" +
      '<t:AttachmentId Id="att-pdf"/>' +
      "<t:Name>AIRR-Parts.pdf</t:Name>" +
      "<t:ContentType>application/pdf</t:ContentType>" +
      "<t:Size>3000000</t:Size>" +
      "<t:IsInline>false</t:IsInline>" +
      "</t:FileAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      return {
        status: "failed",
        error: { code: 0, message: "current item must use the direct path" },
      };
    });
    const fetchMock = installFetchMock((body) => {
      // Both the body-shape GetItem AND the MIME GetItem for the current item go
      // through the direct proxy. Differentiate by IncludeMimeContent.
      if (isMimeGetItem(body)) {
        return {
          ok: true,
          xml: getItemMimeContentResponse(
            mimeWithAttachment({
              filename: "AIRR-Parts.pdf",
              mimeType: "application/pdf",
              bytes: "real-pdf-bytes",
            }),
          ),
        };
      }
      return {
        ok: true,
        xml: messageItemResponse({
          itemId: "m1",
          subject: "With PDF",
          attachmentsXml,
        }),
      };
    });

    const { messages } = await fetchConversationMessagesViaEws("conv-1");

    const attachment = messages[0].attachments?.[0];
    expect(attachment?.["@odata.type"]).toBe("#microsoft.graph.fileAttachment");
    expect(attachment?.name).toBe("AIRR-Parts.pdf");
    expect(attachment?.contentBytes).toBe(btoa("real-pdf-bytes"));
    // The enrichment MIME GetItem went through the direct proxy (no cap), and no
    // GetAttachment was ever sent on either transport.
    const directBodies = fetchMock.mock.calls.map((c) =>
      String((c[1] as RequestInit).body),
    );
    expect(directBodies.some(isMimeGetItem)).toBe(true);
    expect(directBodies.some((b) => b.includes("<m:GetAttachment>"))).toBe(
      false,
    );
  });

  it("enriches a sibling's byte-less ItemAttachment from the owning message's MIME", async () => {
    // The MIME carries an ItemAttachment as a nested message/rfc822 part too, so
    // the same one-GetItem-MIME-per-message path serves it; we match by filename.
    const attachmentsXml =
      "<t:Attachments><t:ItemAttachment>" +
      '<t:AttachmentId Id="att-item-1"/>' +
      "<t:Name>nested.eml</t:Name>" +
      "<t:ContentType>message/rfc822</t:ContentType>" +
      "</t:ItemAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      if (isMimeGetItem(body)) {
        return {
          status: "succeeded",
          value: getItemMimeContentResponse(
            mimeWithAttachment({
              filename: "nested.eml",
              mimeType: "message/rfc822",
              bytes: "nested-eml",
            }),
          ),
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Forwarded item",
          attachmentsXml,
        }),
      };
    });

    const { messages } = await fetchConversationMessagesViaEws("conv-1");

    const attachment = messages[0].attachments?.[0];
    expect(attachment?.["@odata.type"]).toBe("#microsoft.graph.itemAttachment");
    expect(attachment?.contentBytes).toBe(btoa("nested-eml"));
    expect(attachment?.contentType).toBe("message/rfc822");
  });

  it("enriches a byte-less ItemAttachment whose nested message/rfc822 part has NO Content-Disposition (forced to an attachment, matched by type)", async () => {
    // A forwarded email can arrive as a nested message/rfc822 part with no
    // Content-Disposition. With postal-mime's default parsing that submessage is
    // INLINED — its bytes are lost and its inner content leaks into the parent
    // body — so the byte-less ItemAttachment never gets filled. We parse with
    // `rfc822Attachments: true`, which surfaces it as a filename-less,
    // Content-ID-less attachment, then pair it to the ItemAttachment by type.
    const boundary = "----EWS-MIME-BOUNDARY";
    const innerEml =
      `From: orig@x${CRLF}To: me@x${CRLF}Subject: Forwarded thing${CRLF}` +
      `MIME-Version: 1.0${CRLF}Content-Type: text/plain${CRLF}${CRLF}` +
      `inner body${CRLF}`;
    const mime =
      `From: a@x${CRLF}To: b@x${CRLF}Subject: Parent${CRLF}MIME-Version: 1.0${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${boundary}"${CRLF}${CRLF}` +
      `--${boundary}${CRLF}Content-Type: text/plain${CRLF}${CRLF}` +
      `see forwarded${CRLF}` +
      // The nested message carries NO Content-Disposition — the leaky case.
      `--${boundary}${CRLF}Content-Type: message/rfc822${CRLF}${CRLF}${innerEml}` +
      `--${boundary}--${CRLF}`;
    const attachmentsXml =
      "<t:Attachments><t:ItemAttachment>" +
      '<t:AttachmentId Id="att-item-1"/>' +
      "<t:Name>Forwarded thing</t:Name>" +
      "<t:ContentType>message/rfc822</t:ContentType>" +
      "</t:ItemAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      if (isMimeGetItem(body)) {
        return {
          status: "succeeded",
          value: getItemMimeContentResponse(mime),
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Forwarded item",
          attachmentsXml,
        }),
      };
    });

    const { messages } = await fetchConversationMessagesViaEws("conv-1");

    const attachment = messages[0].attachments?.[0];
    expect(attachment?.["@odata.type"]).toBe("#microsoft.graph.itemAttachment");
    // The nested email survived as an attachment (not inlined) and its bytes were
    // spliced onto the byte-less ItemAttachment despite the missing filename/CID.
    expect(attachment?.contentBytes).toBeTruthy();
    const decoded = atob(attachment!.contentBytes!);
    expect(decoded).toContain("Subject: Forwarded thing");
    expect(decoded).toContain("inner body");
  });

  it("leaves an attachment byte-less (disclosure marker downstream) when the owning message's MIME GetItem errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const attachmentsXml =
      "<t:Attachments><t:ItemAttachment>" +
      '<t:AttachmentId Id="att-item-1"/>' +
      "<t:Name>nested.eml</t:Name>" +
      "</t:ItemAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      if (isMimeGetItem(body)) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetItemResponse><m:ResponseMessages>" +
              '<m:GetItemResponseMessage ResponseClass="Error">' +
              "<m:ResponseCode>ErrorItemNotFound</m:ResponseCode>" +
              "</m:GetItemResponseMessage>" +
              "</m:ResponseMessages></m:GetItemResponse>",
          ),
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Forwarded item",
          attachmentsXml,
        }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    expect(state).toBe("ok");
    expect(messages[0].attachments?.[0].contentBytes).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("leaves a sibling's attachments byte-less (partial) when the owning message's MIME GetItem overflows the host size cap (9020)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const attachmentsXml =
      "<t:Attachments><t:FileAttachment>" +
      '<t:AttachmentId Id="att-big"/>' +
      "<t:Name>big.pdf</t:Name>" +
      "<t:ContentType>application/pdf</t:ContentType>" +
      "<t:Size>4000000</t:Size>" +
      "<t:IsInline>false</t:IsInline>" +
      "</t:FileAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      // The attachment-MIME GetItem overflows the host response cap.
      if (isMimeGetItem(body)) {
        return {
          status: "failed",
          error: { code: 9020, message: "Response exceeds 5 MB size limit" },
        };
      }
      // The body-shape GetItem is small and succeeds.
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Big attachment",
          attachmentsXml,
        }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    // The message survives with its metadata; only its attachment bytes are
    // missing. The fetch stays usable; the message's body still rendered fine.
    expect(messages[0].subject).toBe("Big attachment");
    expect(messages[0].attachments?.[0].name).toBe("big.pdf");
    expect(messages[0].attachments?.[0].contentBytes).toBeUndefined();
    // The body fetch all succeeded, so the conversation state is "ok"; the
    // attachment degradation is disclosed per-attachment downstream, not as a
    // thread-level partial.
    expect(state).toBe("ok");
    warnSpy.mockRestore();
  });

  it("does NOT mis-degrade a 'web method is unavailable'/ErrorAccessDenied MIME GetItem as oversize — attachment stays byte-less, thread stays usable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const attachmentsXml =
      "<t:Attachments><t:FileAttachment>" +
      '<t:AttachmentId Id="att-1"/>' +
      "<t:Name>doc.pdf</t:Name>" +
      "<t:ContentType>application/pdf</t:ContentType>" +
      "<t:Size>1234</t:Size>" +
      "<t:IsInline>false</t:IsInline>" +
      "</t:FileAttachment></t:Attachments>";
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsResponse(["m1"]),
        };
      }
      // The attachment-MIME GetItem comes back ErrorAccessDenied ("web method
      // unavailable"). This must NOT be treated as the size cap; it surfaces as a
      // hard EwsRequestError, caught per-message, leaving the attachment byte-less.
      if (isMimeGetItem(body)) {
        return {
          status: "failed",
          error: {
            code: 0,
            message:
              "The requested web method is unavailable to this caller or application.",
          },
        };
      }
      return {
        status: "succeeded",
        value: messageItemResponse({
          itemId: "m1",
          subject: "Doc",
          attachmentsXml,
        }),
      };
    });

    const { messages, state } = await fetchConversationMessagesViaEws("conv-1");

    // Body fetch succeeded → thread is "ok"; only the attachment bytes are
    // missing (disclosed as a marker downstream), the message itself is intact.
    expect(state).toBe("ok");
    expect(messages[0].subject).toBe("Doc");
    expect(messages[0].attachments?.[0].name).toBe("doc.pdf");
    expect(messages[0].attachments?.[0].contentBytes).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("ewsHostFetch surfaces a SOAP Fault in a host response as EwsRequestError", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A SOAP Fault in the host GetConversationItems response is parsed by the
    // shared parseEwsSoap and thrown as EwsRequestError, degrading the fetch to
    // error (the enumeration could not be read).
    installHostMock(() => ({
      status: "succeeded",
      value:
        '<?xml version="1.0"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
        "<s:Body><s:Fault>" +
        "<faultcode>s:Client</faultcode>" +
        "<faultstring>Host fault</faultstring>" +
        "</s:Fault></s:Body></s:Envelope>",
    }));

    const result = await fetchConversationMessagesViaEws("conv-1");

    expect(result).toEqual({ messages: [], state: "error" });
    warnSpy.mockRestore();
  });
});

describe("fetchParentMessageInConversationViaEws", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
  });

  /** GetConversationItems response whose members carry the chip metadata
   * INLINE (subject/From/DateTimeReceived/IsDraft) — what the metadata-only
   * parent lookup consumes; there is nothing left to GetItem. */
  function conversationItemsMetadataResponse(
    members: Array<{
      itemId: string;
      subject: string;
      fromName: string;
      fromAddress: string;
      received: string;
      isDraft?: boolean;
    }>,
  ): string {
    const nodes = members
      .map(
        (member) =>
          "<t:ConversationNode><t:Items><t:Message>" +
          `<t:ItemId Id="${member.itemId}"/>` +
          `<t:Subject>${member.subject}</t:Subject>` +
          `<t:DateTimeReceived>${member.received}</t:DateTimeReceived>` +
          `<t:IsDraft>${member.isDraft ? "true" : "false"}</t:IsDraft>` +
          "<t:From><t:Mailbox>" +
          `<t:Name>${member.fromName}</t:Name>` +
          `<t:EmailAddress>${member.fromAddress}</t:EmailAddress>` +
          "</t:Mailbox></t:From>" +
          "</t:Message></t:Items></t:ConversationNode>",
      )
      .join("");
    return soap(
      "<m:GetConversationItemsResponse><m:ResponseMessages>" +
        '<m:GetConversationItemsResponseMessage ResponseClass="Success">' +
        "<m:ResponseCode>NoError</m:ResponseCode>" +
        `<m:Conversation><t:ConversationNodes>${nodes}</t:ConversationNodes></m:Conversation>` +
        "</m:GetConversationItemsResponseMessage>" +
        "</m:ResponseMessages></m:GetConversationItemsResponse>",
    );
  }

  it("returns the latest non-draft metadata from the enumeration alone — no GetItem, no attachment MIME fetch, no direct proxy call", async () => {
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: conversationItemsMetadataResponse([
            {
              itemId: "m1",
              subject: "Earlier",
              fromName: "Bob",
              fromAddress: "bob@x",
              received: "2026-04-27T08:00:00Z",
            },
            {
              itemId: "m2",
              subject: "Latest non-draft",
              fromName: "Carol",
              fromAddress: "carol@x",
              received: "2026-04-29T09:00:00Z",
            },
            {
              itemId: "draft",
              subject: "My draft",
              fromName: "Me",
              fromAddress: "me@x",
              received: "2026-04-29T11:00:00Z",
              isDraft: true,
            },
          ]),
        };
      }
      // Any other host operation (a GetItem!) is a budget violation.
      return {
        status: "failed",
        error: { code: 0, message: "unexpected non-enumeration operation" },
      };
    });
    // The direct proxy must not be touched either (no body/MIME fetches).
    const fetchMock = installFetchMock(() => ({ ok: true }));

    const result = await fetchParentMessageInConversationViaEws("conv-1");

    expect(result).toEqual({
      subject: "Latest non-draft",
      fromName: "Carol",
      fromAddress: "carol@x",
    });
    // METADATA-ONLY: exactly one host round-trip — the enumeration itself,
    // carrying the chip fields — and zero GetItem/GetAttachment/proxy calls.
    expect(hostMock).toHaveBeenCalledTimes(1);
    const enumBody = String(hostMock.mock.calls[0][0] ?? "");
    expect(enumBody).toContain("<m:GetConversationItems>");
    expect(enumBody).toContain('<t:FieldURI FieldURI="item:Subject"/>');
    expect(enumBody).toContain(
      '<t:FieldURI FieldURI="item:DateTimeReceived"/>',
    );
    expect(enumBody).toContain('<t:FieldURI FieldURI="message:From"/>');
    expect(enumBody).toContain('<t:FieldURI FieldURI="item:IsDraft"/>');
    expect(enumBody).not.toContain("<m:GetItem>");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to a metadata FindItem across the well-known folders when GetConversationItems rejects the id — still no GetItem", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Error">' +
              "<m:ResponseCode>ErrorInvalidIdMalformed</m:ResponseCode>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      // The FindItem fallback carries the metadata inline as well. Real
      // FindItem omits the From EmailAddress (summary shape) — only the
      // display Name survives.
      return {
        status: "succeeded",
        value: soap(
          "<m:FindItemResponse><m:ResponseMessages>" +
            '<m:FindItemResponseMessage ResponseClass="Success">' +
            "<m:ResponseCode>NoError</m:ResponseCode>" +
            "<m:RootFolder><t:Items><t:Message>" +
            '<t:ItemId Id="m1"/>' +
            "<t:Subject>Found via FindItem</t:Subject>" +
            "<t:DateTimeReceived>2026-04-29T09:00:00Z</t:DateTimeReceived>" +
            "<t:IsDraft>false</t:IsDraft>" +
            "<t:From><t:Mailbox><t:Name>Carol</t:Name></t:Mailbox></t:From>" +
            "</t:Message></t:Items></m:RootFolder>" +
            "</m:FindItemResponseMessage>" +
            "</m:ResponseMessages></m:FindItemResponse>",
        ),
      };
    });

    const result = await fetchParentMessageInConversationViaEws("conv-1");

    // The chip degrades to name-only rather than failing (FindItem's summary
    // shape omits the From EmailAddress by design).
    expect(result).toEqual({
      subject: "Found via FindItem",
      fromName: "Carol",
      fromAddress: null,
    });
    const hostBodies = hostMock.mock.calls.map((call) => String(call[0] ?? ""));
    const findBody = hostBodies.find((body) => body.includes("<m:FindItem"));
    expect(findBody).toContain('<t:FieldURI FieldURI="item:Subject"/>');
    expect(findBody).toContain(
      "<m:ParentFolderIds>" +
        '<t:DistinguishedFolderId Id="inbox"/>' +
        '<t:DistinguishedFolderId Id="sentitems"/>' +
        '<t:DistinguishedFolderId Id="drafts"/>' +
        '<t:DistinguishedFolderId Id="deleteditems"/>' +
        '<t:DistinguishedFolderId Id="junkemail"/>' +
        "</m:ParentFolderIds>",
    );
    // No member body was ever fetched.
    expect(hostBodies.some((body) => body.includes("<m:GetItem>"))).toBe(false);
    warnSpy.mockRestore();
  });

  it("returns null (not throw) when the metadata enumeration fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    installHostMock(() => ({
      status: "failed",
      error: { code: 0, message: "Bad Request" },
    }));

    const result = await fetchParentMessageInConversationViaEws("conv-1");

    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null when the enumeration carries no metadata (no member has a DateTimeReceived)", async () => {
    // Bare-id members: IsDraft/DateTimeReceived/Subject/From all absent.
    // isDraft === undefined passes the non-draft filter and an undefined
    // receivedDateTime would sort on "" — selecting from these would render
    // the chip for an arbitrary member (possibly the user's own open draft),
    // so the chip must degrade to null like every other failure mode.
    const hostMock = installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Success">' +
              "<m:ResponseCode>NoError</m:ResponseCode>" +
              "<m:Conversation><t:ConversationNodes>" +
              "<t:ConversationNode><t:Items>" +
              '<t:Message><t:ItemId Id="m1"/></t:Message>' +
              '<t:Message><t:ItemId Id="m2"/></t:Message>' +
              "</t:Items></t:ConversationNode>" +
              "</t:ConversationNodes></m:Conversation>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      return {
        status: "failed",
        error: { code: 0, message: "unexpected non-enumeration operation" },
      };
    });

    const result = await fetchParentMessageInConversationViaEws("conv-1");

    expect(result).toBeNull();
    expect(hostMock).toHaveBeenCalledTimes(1);
  });

  it("never lets a member missing DateTimeReceived win over a dated one", async () => {
    installHostMock((body) => {
      if (body.includes("<m:GetConversationItems>")) {
        return {
          status: "succeeded",
          value: soap(
            "<m:GetConversationItemsResponse><m:ResponseMessages>" +
              '<m:GetConversationItemsResponseMessage ResponseClass="Success">' +
              "<m:ResponseCode>NoError</m:ResponseCode>" +
              "<m:Conversation><t:ConversationNodes>" +
              "<t:ConversationNode><t:Items>" +
              // A metadata-less member (no IsDraft, no DateTimeReceived).
              '<t:Message><t:ItemId Id="bare"/>' +
              "<t:Subject>Bare member</t:Subject></t:Message>" +
              // A fully-dated non-draft member.
              '<t:Message><t:ItemId Id="dated"/>' +
              "<t:Subject>Dated member</t:Subject>" +
              "<t:DateTimeReceived>2026-04-29T09:00:00Z</t:DateTimeReceived>" +
              "<t:IsDraft>false</t:IsDraft>" +
              "<t:From><t:Mailbox><t:Name>Carol</t:Name>" +
              "<t:EmailAddress>carol@x</t:EmailAddress>" +
              "</t:Mailbox></t:From></t:Message>" +
              "</t:Items></t:ConversationNode>" +
              "</t:ConversationNodes></m:Conversation>" +
              "</m:GetConversationItemsResponseMessage>" +
              "</m:ResponseMessages></m:GetConversationItemsResponse>",
          ),
        };
      }
      return {
        status: "failed",
        error: { code: 0, message: "unexpected non-enumeration operation" },
      };
    });

    const result = await fetchParentMessageInConversationViaEws("conv-1");

    expect(result).toEqual({
      subject: "Dated member",
      fromName: "Carol",
      fromAddress: "carol@x",
    });
  });

  it("rejects with the abort reason when the signal is already aborted (the dispatcher timeout contract)", async () => {
    // runWithGraphTimeout only aborts the signal and trusts the callee to
    // reject — a swallowed abort (null) would make the 10s timeout a no-op.
    const hostMock = installHostMock(() => ({
      status: "succeeded",
      value: soap(""),
    }));
    const controller = new AbortController();
    const reason = new Error("parent lookup timed out");
    controller.abort(reason);

    await expect(
      fetchParentMessageInConversationViaEws("conv-1", {
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    // The abort was honored before spending any host round-trip.
    expect(hostMock).not.toHaveBeenCalled();
  });
});
