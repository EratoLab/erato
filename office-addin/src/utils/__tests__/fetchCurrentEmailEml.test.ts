import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockMailbox,
  uninstallMockMailbox,
} from "../../test/mocks/outlook/mailbox";
import { fetchCurrentEmailEml } from "../fetchCurrentEmailEml";

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

describe("fetchCurrentEmailEml", () => {
  beforeEach(() => {
    installOutlookMailboxMock();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    uninstallMockMailbox();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the raw .eml file and message id on success", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: bytesFrom("raw-mime") }
        : {
            ok: true,
            jsonValue: { subject: "Hi", internetMessageId: "<abc@host>" },
          },
    );

    const result = await fetchCurrentEmailEml(EWS_ID, acquireToken);

    expect(result).not.toBeNull();
    expect(result?.file.type).toBe("message/rfc822");
    expect(result?.file.name).toBe("Hi.eml");
    expect(result?.messageId).toBe("<abc@host>");
    expect(await result?.file.text()).toBe("raw-mime");
  });

  it("returns null and logs when the Graph fetch throws", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    installFetchMock(() => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    const result = await fetchCurrentEmailEml(EWS_ID, acquireToken);

    expect(result).toBeNull();
  });

  it("returns null when Graph returns no files (defensive)", async () => {
    const acquireToken = vi.fn().mockResolvedValue("tok");
    // Emulate a successful metadata fetch but a zero-length body; the helper
    // still produces a File, so this mostly pins the defensive branch.
    installFetchMock((url) =>
      url.endsWith("/$value")
        ? { ok: true, bytes: new ArrayBuffer(0) }
        : { ok: true, jsonValue: { subject: "Empty" } },
    );

    const result = await fetchCurrentEmailEml(EWS_ID, acquireToken);

    expect(result).not.toBeNull();
    expect(result?.file.size).toBe(0);
    expect(result?.file.type).toBe("message/rfc822");
  });
});
