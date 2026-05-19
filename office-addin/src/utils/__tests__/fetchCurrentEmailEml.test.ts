import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { fetchCurrentEmailParsed } from "../fetchCurrentEmailEml";

const EWS_ID = "AAkALgAAA-ews-id";
const GRAPH_ID = "graph-id-converted";

function installOutlookMailboxMock() {
  const mailbox = installMockMailbox() as ReturnType<
    typeof installMockMailbox
  > & { convertToRestId: ReturnType<typeof vi.fn> };
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

describe("fetchCurrentEmailParsed", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const CRLF = "\r\n";

  function buildEml(
    subject: string,
    messageId: string,
    body = "hello",
  ): string {
    return (
      `From: Alice <alice@example.com>${CRLF}` +
      `To: Bob <bob@example.com>${CRLF}` +
      `Subject: ${subject}${CRLF}` +
      `Message-ID: ${messageId}${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain; charset=utf-8${CRLF}` +
      `${CRLF}` +
      body
    );
  }

  it("parses the Graph-returned MIME into a ParsedEmail and prefers the parsed Message-ID", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const eml = buildEml("Hi parsed", "<parsed-id@example.com>");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom(eml) }
        : {
            ok: true,
            jsonValue: {
              subject: "Hi parsed",
              internetMessageId: "<graph-id@example.com>",
            },
          },
    );

    const result = await fetchCurrentEmailParsed(EWS_ID, acquireToken);

    expect(result).not.toBeNull();
    expect(result?.parsed.subject).toBe("Hi parsed");
    expect(result?.parsed.from).toEqual({
      name: "Alice",
      address: "alice@example.com",
    });
    expect(result?.messageId).toBe("<parsed-id@example.com>");
    expect(result?.parsed.rawEmlFile.type).toBe("message/rfc822");
  });

  it("falls back to Graph's internetMessageId when the parsed bytes lack a Message-ID header", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const eml =
      `From: a@x${CRLF}` +
      `To: b@x${CRLF}` +
      `Subject: No id${CRLF}` +
      `MIME-Version: 1.0${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}body`;
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom(eml) }
        : {
            ok: true,
            jsonValue: {
              subject: "No id",
              internetMessageId: "<graph-id@example.com>",
            },
          },
    );

    const result = await fetchCurrentEmailParsed(EWS_ID, acquireToken);

    expect(result?.messageId).toBe("<graph-id@example.com>");
  });

  it("returns null and logs when the Graph fetch fails", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    const result = await fetchCurrentEmailParsed(EWS_ID, acquireToken);

    expect(result).toBeNull();
  });
});
