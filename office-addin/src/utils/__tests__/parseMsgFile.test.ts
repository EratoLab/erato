import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCfbWith,
  buildMsgWithInternetMessageId,
  msgFileFromBytes,
  utf16le,
} from "../../test/fixtures/msg";
import { parseMsgFileToFiles } from "../parseMsgFile";

// Both collaborators (`extractMsgInternetMessageId` and the Graph client) run
// for real. Only the network boundary is stubbed, via `vi.stubGlobal("fetch")`
// mirroring `fetchOutlookMessageGraph.test.ts`. This pins the load-bearing
// contract — "preserve the Message-ID on Graph failure so the dedup path
// still works" — against real CFB decoding and real Graph-request shaping;
// drift in either module now fails a test in this file.

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

describe("parseMsgFileToFiles", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes real CFB, resolves via Graph filter + $value, and returns a single .eml with the id", async () => {
    const file = msgFileFromBytes(buildMsgWithInternetMessageId("<abc@host>"));
    const acquireToken = vi.fn().mockResolvedValue("tok");
    const fetchMock = installFetchMock((url) => {
      if (url.includes("$filter=")) {
        return {
          ok: true,
          jsonValue: {
            value: [
              {
                id: "matched-id",
                subject: "Hi",
                internetMessageId: "<abc@host>",
              },
            ],
          },
        };
      }
      return { ok: true, bytes: bytesFrom("raw-mime") };
    });

    const result = await parseMsgFileToFiles(file, acquireToken);

    expect(result.messageId).toBe("<abc@host>");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe("message/rfc822");
    expect(result.files[0].name).toBe("Hi.eml");
    expect(await result.files[0].text()).toBe("raw-mime");

    expect(acquireToken).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [filterUrl] = fetchMock.mock.calls[0];
    expect(filterUrl).toContain(
      encodeURIComponent("internetMessageId eq '<abc@host>'"),
    );
    const [valueUrl] = fetchMock.mock.calls[1];
    expect(valueUrl).toContain(
      `/me/messages/${encodeURIComponent("matched-id")}/$value`,
    );
  });

  it("returns empty files with null id and does not hit Graph when the CFB has no Internet-Message-ID stream", async () => {
    // Valid CFB carrying a different MAPI property (subject) but no
    // PR_INTERNET_MESSAGE_ID_W — mirrors drafts that haven't been assigned
    // an Internet Message-ID yet, which is the documented skip path.
    const file = msgFileFromBytes(
      buildCfbWith([
        { name: "__substg1.0_0037001F", content: utf16le("Some subject") },
      ]),
      "no-id.msg",
    );
    const acquireToken = vi.fn();
    const fetchMock = installFetchMock(() => ({ ok: true }));

    const result = await parseMsgFileToFiles(file, acquireToken);

    expect(result).toEqual({ files: [], messageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(acquireToken).not.toHaveBeenCalled();
  });

  it("returns empty files with null id and does not hit Graph for non-CFB bytes", async () => {
    const file = msgFileFromBytes(new Uint8Array([1, 2, 3, 4]), "broken.msg");
    const acquireToken = vi.fn();
    const fetchMock = installFetchMock(() => ({ ok: true }));

    const result = await parseMsgFileToFiles(file, acquireToken);

    expect(result).toEqual({ files: [], messageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(acquireToken).not.toHaveBeenCalled();
  });

  // Both flavors of Graph failure must preserve the extracted Message-ID so
  // that `expandDroppedEmailFiles`' dedup path can still suppress re-drops
  // of the same email. Parameterized because the outcome is identical.
  it.each([
    {
      label: "Graph filter yields no match",
      responder: (): MockResponse => ({
        ok: true,
        jsonValue: { value: [] },
      }),
    },
    {
      label: "Graph filter returns a non-OK status",
      responder: (): MockResponse => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    },
  ])("preserves the Message-ID when $label", async ({ responder }) => {
    const file = msgFileFromBytes(buildMsgWithInternetMessageId("<abc@host>"));
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(responder);

    const result = await parseMsgFileToFiles(file, acquireToken);

    expect(result).toEqual({ files: [], messageId: "<abc@host>" });
  });
});
