import { describe, expect, it, vi } from "vitest";

import { createGraphOutlookMessageFetcher } from "../fetchOutlookMessage";
import { fetchCurrentThread, ThreadFetchError } from "../parsedThread";

import type {
  GraphConversationMessage,
  GraphTransport,
} from "../fetchOutlookMessageGraph";

const FILE_ATTACHMENT = "#microsoft.graph.fileAttachment";
const ITEM_ATTACHMENT = "#microsoft.graph.itemAttachment";
const REFERENCE_ATTACHMENT = "#microsoft.graph.referenceAttachment";

function makeTransport(value: GraphConversationMessage[]): GraphTransport {
  return vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ value }),
      }) as Response,
  );
}

function makeFailingTransport(status: number): GraphTransport {
  return vi.fn(
    async () =>
      ({
        ok: false,
        status,
        statusText: "Server Error",
        json: async () => ({}),
      }) as Response,
  );
}

// The Graph-backed conversation capability, with only the network boundary
// (the injected transport) stubbed per test — same coverage as before the
// dispatcher seam, now exercised through it.
const { fetchConversationMessages } = createGraphOutlookMessageFetcher(
  async () => "test-token",
);

describe("fetchCurrentThread", () => {
  it("filters drafts out of the thread", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "Real message",
        body: { contentType: "text", content: "hello" },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
      },
      {
        id: "m2",
        internetMessageId: "<m2@x>",
        subject: "Draft reply",
        body: { contentType: "text", content: "drafting…" },
        sentDateTime: "2026-03-02T10:00:00Z",
        isDraft: true,
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    expect(thread).not.toBeNull();
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0].id).toBe("<m1@x>");
  });

  it("defaults to the full html body so forwarded content is never lost", async () => {
    // The forward bug: uniqueBody is just the signature, the forwarded payload
    // lives only in `body`. HTML uniqueBody is an independent fragment (not a
    // substring of `body`), so we must keep the full body.
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "forward with only a signature in uniqueBody",
        body: {
          contentType: "html",
          content: "<p>full thread quote</p><p>Sent from Outlook for Mac</p>",
        },
        uniqueBody: {
          contentType: "html",
          content: "<p>Sent from Outlook for Mac</p>",
        },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
      },
      {
        id: "m2",
        internetMessageId: "<m2@x>",
        subject: "text fallback",
        body: {
          contentType: "text",
          content: "fallback wins when uniqueBody missing",
        },
        receivedDateTime: "2026-03-02T10:00:00Z",
        isDraft: false,
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    // Full body kept (forwarded content survives), not the signature-only uniqueBody.
    expect(thread?.messages[0].bodyHtml).toContain("full thread quote");
    expect(thread?.messages[0].bodyText).toBeNull();
    expect(thread?.messages[1].bodyText).toContain("fallback wins");
    expect(thread?.messages[1].bodyHtml).toBeNull();
  });

  it("collapses to a plaintext uniqueBody only when it is a provable subset of the full body", async () => {
    const transport = makeTransport([
      {
        id: "subset",
        internetMessageId: "<subset@x>",
        subject: "plaintext reply with quoted tail",
        body: {
          contentType: "text",
          content: "Reply text\n\n> On 1 Jan, X wrote:\n> quoted history",
        },
        uniqueBody: { contentType: "text", content: "Reply text" },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
      },
      {
        id: "notsubset",
        internetMessageId: "<notsubset@x>",
        subject: "plaintext uniqueBody NOT contained in full",
        body: { contentType: "text", content: "The real full body" },
        uniqueBody: { contentType: "text", content: "something entirely else" },
        receivedDateTime: "2026-03-02T10:00:00Z",
        isDraft: false,
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    // Provable subset → collapse to the smaller copy (token win, loss-free).
    expect(thread?.messages[0].bodyText).toBe("Reply text");
    // Not a subset → keep the full body (never risk dropping content).
    expect(thread?.messages[1].bodyText).toBe("The real full body");
  });

  it("does NOT collapse a plaintext subset when the thread is incomplete (dropped tail may be the only copy)", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // First page succeeds with a collapsible plaintext message, but a later
    // page fails → thread is partial → the quoted tail must be retained.
    let call = 0;
    const transport: GraphTransport = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            value: [
              {
                id: "subset",
                internetMessageId: "<subset@x>",
                subject: "reply quoting an earlier (unfetched) message",
                body: {
                  contentType: "text",
                  content:
                    "Reply text\n\n> On 1 Jan, X wrote:\n> quoted history",
                },
                uniqueBody: { contentType: "text", content: "Reply text" },
                receivedDateTime: "2026-03-02T10:00:00Z",
                isDraft: false,
              },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=PAGE2",
          }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      } as unknown as Response;
    });

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );
    consoleWarn.mockRestore();

    expect(thread?.incomplete).toBe(true);
    // Full body kept despite the subset being collapsible on a complete thread.
    expect(thread?.messages[0].bodyText).toContain("quoted history");
  });

  it("reads isHtml from the chosen source so an empty html uniqueBody can't mislabel a plaintext body", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "isHtml decoupling",
        // uniqueBody is typed html but empty; body is the real plaintext.
        uniqueBody: { contentType: "html", content: "" },
        body: {
          contentType: "text",
          content: "a<b and R&D, List<String> survive intact",
        },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    expect(thread?.messages[0].bodyHtml).toBeNull();
    expect(thread?.messages[0].bodyText).toBe(
      "a<b and R&D, List<String> survive intact",
    );
  });

  it("surfaces itemAttachment and referenceAttachment as disclosure markers instead of dropping them", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "mixed attachments",
        body: { contentType: "text", content: "see attached" },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
        attachments: [
          {
            "@odata.type": FILE_ATTACHMENT,
            id: "att-1",
            name: "report.pdf",
            contentType: "application/pdf",
            size: 12,
            isInline: false,
            contentBytes: "aGVsbG8gd29ybGQ=", // base64 "hello world"
          },
          {
            "@odata.type": ITEM_ATTACHMENT,
            id: "att-2",
            name: "Forwarded email",
            contentType: "message/rfc822",
            size: 999,
            isInline: false,
          },
          {
            "@odata.type": REFERENCE_ATTACHMENT,
            id: "att-3",
            name: "shared-link.url",
            contentType: "application/vnd.ms-onedrive",
            size: 0,
            isInline: false,
          },
        ],
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    // All three are kept (none silently dropped, INV-9).
    expect(thread?.messages[0].attachments).toHaveLength(3);
    const [file, item, reference] = thread!.messages[0].attachments;

    expect(file.filename).toBe("report.pdf");
    expect(file.contentBytes).not.toBeNull();
    expect(file.contentBytes!.byteLength).toBe(11); // "hello world"
    expect(file.unavailableReason).toBeNull();
    expect(file.id).toBe("<m1@x>:att-1");

    // The transport stub returns no arrayBuffer, so item $value enrichment
    // fails gracefully → disclosed as a marker rather than dropped.
    expect(item.contentBytes).toBeNull();
    expect(item.unavailableReason).toContain("could not be retrieved");

    expect(reference.contentBytes).toBeNull();
    expect(reference.unavailableReason).toContain("cloud attachment");
  });

  it("decodes an itemAttachment whose bytes the fetch layer enriched via /$value", async () => {
    // Transport that serves the conversation list, then the item's $value MIME.
    const transport: GraphTransport = vi.fn(async (url: string) => {
      if (url.includes("/attachments/") && url.endsWith("/$value")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () =>
            new TextEncoder().encode("Forwarded .eml bytes").buffer,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          value: [
            {
              id: "graph-m1",
              internetMessageId: "<m1@x>",
              subject: "with forwarded item",
              body: { contentType: "text", content: "see forwarded" },
              receivedDateTime: "2026-03-01T10:00:00Z",
              isDraft: false,
              attachments: [
                {
                  "@odata.type": ITEM_ATTACHMENT,
                  id: "item-1",
                  name: "Forwarded.eml",
                  contentType: "message/rfc822",
                  size: 20,
                  isInline: false,
                },
              ],
            },
          ],
        }),
      } as unknown as Response;
    });

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    const [att] = thread!.messages[0].attachments;
    expect(att.contentBytes).not.toBeNull();
    expect(att.unavailableReason).toBeNull();
    expect(new TextDecoder().decode(new Uint8Array(att.contentBytes!))).toBe(
      "Forwarded .eml bytes",
    );
  });

  it("preserves the isInline flag on attachments so the provider can filter them", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "inline image",
        body: { contentType: "html", content: "<img src='cid:logo'>" },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
        attachments: [
          {
            "@odata.type": FILE_ATTACHMENT,
            id: "logo",
            name: "logo.png",
            contentType: "image/png",
            size: 4,
            isInline: true,
            contentBytes: "AAEC", // arbitrary bytes
            contentId: "logo",
          },
        ],
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    expect(thread?.messages[0].attachments).toHaveLength(1);
    expect(thread?.messages[0].attachments[0].isInline).toBe(true);
    expect(thread?.messages[0].attachments[0].contentId).toBe("logo");
  });

  it("sorts messages chronologically and uses the latest subject for the outer thread", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "Re: Re: Original",
        body: { contentType: "text", content: "third" },
        receivedDateTime: "2026-03-10T10:00:00Z",
        isDraft: false,
      },
      {
        id: "m2",
        internetMessageId: "<m2@x>",
        subject: "Original",
        body: { contentType: "text", content: "first" },
        receivedDateTime: "2026-03-01T10:00:00Z",
        isDraft: false,
      },
      {
        id: "m3",
        internetMessageId: "<m3@x>",
        subject: "Re: Original",
        body: { contentType: "text", content: "second" },
        receivedDateTime: "2026-03-05T10:00:00Z",
        isDraft: false,
      },
    ]);

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );

    expect(thread?.messages.map((m) => m.subject)).toEqual([
      "Original",
      "Re: Original",
      "Re: Re: Original",
    ]);
    expect(thread?.subject).toBe("Re: Re: Original");
  });

  it("returns null for a genuinely empty conversation (no messages, no error)", async () => {
    expect(
      await fetchCurrentThread("missing-conv", fetchConversationMessages, {
        transport: makeTransport([]),
      }),
    ).toBeNull();
  });

  it("throws ThreadFetchError when the first-page fetch fails (loud, not silent null)", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchCurrentThread("conv-1", fetchConversationMessages, {
        transport: makeFailingTransport(500),
      }),
    ).rejects.toBeInstanceOf(ThreadFetchError);
    consoleWarn.mockRestore();
  });

  it("marks the thread incomplete when a later page fails after the first succeeds", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let call = 0;
    const transport: GraphTransport = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            value: [
              {
                id: "m1",
                internetMessageId: "<m1@x>",
                subject: "page one",
                body: { contentType: "text", content: "first page body" },
                receivedDateTime: "2026-03-01T10:00:00Z",
                isDraft: false,
              },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=PAGE2",
          }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({}),
      } as unknown as Response;
    });

    const thread = await fetchCurrentThread(
      "conv-1",
      fetchConversationMessages,
      {
        transport,
      },
    );
    consoleWarn.mockRestore();

    expect(thread).not.toBeNull();
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.incomplete).toBe(true);
  });
});
