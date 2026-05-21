import { describe, expect, it, vi } from "vitest";

import { fetchCurrentThread } from "../parsedThread";

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

const acquireToken = async () => "test-token";

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

    const thread = await fetchCurrentThread("conv-1", acquireToken, {
      transport,
    });

    expect(thread).not.toBeNull();
    expect(thread?.messages).toHaveLength(1);
    expect(thread?.messages[0].id).toBe("<m1@x>");
  });

  it("prefers uniqueBody over body and tracks html vs text content-type", async () => {
    const transport = makeTransport([
      {
        id: "m1",
        internetMessageId: "<m1@x>",
        subject: "html with unique body",
        body: { contentType: "html", content: "<p>full thread quote</p>" },
        uniqueBody: { contentType: "html", content: "<p>just my reply</p>" },
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

    const thread = await fetchCurrentThread("conv-1", acquireToken, {
      transport,
    });

    expect(thread?.messages[0].bodyHtml).toContain("just my reply");
    expect(thread?.messages[0].bodyText).toBeNull();
    expect(thread?.messages[1].bodyText).toContain("fallback wins");
    expect(thread?.messages[1].bodyHtml).toBeNull();
  });

  it("keeps only fileAttachments with contentBytes; skips itemAttachment and referenceAttachment", async () => {
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

    const thread = await fetchCurrentThread("conv-1", acquireToken, {
      transport,
    });

    expect(thread?.messages[0].attachments).toHaveLength(1);
    const [keptAttachment] = thread!.messages[0].attachments;
    expect(keptAttachment.filename).toBe("report.pdf");
    expect(keptAttachment.contentBytes).not.toBeNull();
    expect(keptAttachment.contentBytes!.byteLength).toBe(11); // "hello world"
    expect(keptAttachment.id).toBe("<m1@x>:att-1");
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

    const thread = await fetchCurrentThread("conv-1", acquireToken, {
      transport,
    });

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

    const thread = await fetchCurrentThread("conv-1", acquireToken, {
      transport,
    });

    expect(thread?.messages.map((m) => m.subject)).toEqual([
      "Original",
      "Re: Original",
      "Re: Re: Original",
    ]);
    expect(thread?.subject).toBe("Re: Re: Original");
  });

  it("returns null when Graph returns no messages or errors out", async () => {
    expect(
      await fetchCurrentThread("missing-conv", acquireToken, {
        transport: makeTransport([]),
      }),
    ).toBeNull();
    expect(
      await fetchCurrentThread("missing-conv", acquireToken, {
        transport: makeFailingTransport(500),
      }),
    ).toBeNull();
  });
});
