import { describe, expect, it, vi } from "vitest";

import { createSidecarOutlookMessageFetcher } from "../fetchOutlookMessageSidecar";

import type { OutlookMessageFetcher } from "../fetchOutlookMessage";
import type { FetchConversationResult } from "../fetchOutlookMessageGraph";
import type { DesktopSidecarClient } from "@erato/frontend/library";

const FALLBACK: FetchConversationResult = { messages: [], state: "error" };
// Base64 as the sidecar carries it inline on the wire.
const ATTACHMENT_BYTES = btoa("att01");

function stubInner(): OutlookMessageFetcher {
  return {
    fetchMessageBytes: vi.fn(),
    fetchMessageFilesByInternetMessageId: vi.fn(),
    fetchMessageBytesByInternetMessageId: vi.fn(),
    fetchConversationMessages: vi.fn(async () => FALLBACK),
    fetchParentMessageInConversation: vi.fn(),
  };
}

interface FakeClientOptions {
  supports?: boolean;
  mailboxes?: { id: string; emailAddress?: string }[];
  conversation?: unknown;
}

function defaultConversation() {
  return {
    state: "ok",
    messages: [
      {
        internetMessageId: "<a@b>",
        subject: "Hello",
        from: { name: "A", emailAddress: "a@example.test" },
        to: [{ name: "B", emailAddress: "b@example.test" }],
        cc: [],
        sentAtUnixSeconds: 1_700_000_000,
        isDraft: false,
        body: { contentType: "text/html", content: "<p>Hi</p>" },
        attachments: [
          {
            name: "doc.pdf",
            contentType: "application/pdf",
            size: 5,
            isInline: false,
            sha256: "a".repeat(64),
            contentBytes: ATTACHMENT_BYTES,
          },
        ],
      },
    ],
  };
}

function fakeClient(options: FakeClientOptions = {}): DesktopSidecarClient {
  const {
    supports = true,
    mailboxes = [{ id: "m1", emailAddress: "user@example.test" }],
    conversation = defaultConversation(),
  } = options;
  return {
    supports: () => supports,
    invoke: async (method: string) => {
      if (method === "outlook.list_mailboxes.v1") return { mailboxes };
      if (method === "outlook.get_conversation.v1") return conversation;
      throw new Error(`unexpected invoke ${method}`);
    },
  } as unknown as DesktopSidecarClient;
}

function context(client: DesktopSidecarClient, inner: OutlookMessageFetcher) {
  return {
    inner,
    client,
    anchorInternetMessageId: "<a@b>",
    userEmailAddress: "user@example.test",
  };
}

describe("createSidecarOutlookMessageFetcher", () => {
  it("maps a conversation with inline body and attachment bytes", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(fakeClient(), inner),
    );

    const result = await fetcher.fetchConversationMessages("conv-1");

    expect(inner.fetchConversationMessages).not.toHaveBeenCalled();
    expect(result.state).toBe("ok");
    const message = result.messages[0];
    expect(message.internetMessageId).toBe("<a@b>");
    expect(message.body).toEqual({ contentType: "html", content: "<p>Hi</p>" });

    const attachment = message.attachments![0];
    // The bug review caught: attachments must carry an id, or transformAttachment
    // drops them downstream — defeating the whole sidecar-attachments feature.
    expect(attachment.id).toBeDefined();
    expect(attachment.contentBytes).toBe(ATTACHMENT_BYTES);
    expect(atob(attachment.contentBytes!)).toBe("att01");
  });

  it("falls back to the inner fetcher when the capability is unsupported", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(fakeClient({ supports: false }), inner),
    );

    const result = await fetcher.fetchConversationMessages("conv-1");

    expect(result).toBe(FALLBACK);
    expect(inner.fetchConversationMessages).toHaveBeenCalledOnce();
  });

  it("falls back when no local mailbox matches the user", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(
        fakeClient({
          mailboxes: [{ id: "m1", emailAddress: "other@example.test" }],
        }),
        inner,
      ),
    );

    expect(await fetcher.fetchConversationMessages("conv-1")).toBe(FALLBACK);
  });

  it("falls back when the anchor resolves to no messages", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(
        fakeClient({ conversation: { state: "ok", messages: [] } }),
        inner,
      ),
    );

    expect(await fetcher.fetchConversationMessages("conv-1")).toBe(FALLBACK);
    expect(inner.fetchConversationMessages).toHaveBeenCalledOnce();
  });

  it("degrades an attachment with no bytes to a marker + partial, not a full fallback", async () => {
    const inner = stubInner();
    // The sidecar could not read this attachment: no contentBytes, only a reason.
    const conversation = {
      state: "ok",
      messages: [
        {
          internetMessageId: "<a@b>",
          subject: "Hello",
          from: { name: "A", emailAddress: "a@example.test" },
          to: [],
          cc: [],
          sentAtUnixSeconds: 1_700_000_000,
          isDraft: false,
          body: { contentType: "text/html", content: "<p>Hi</p>" },
          attachments: [
            {
              name: "doc.pdf",
              contentType: "application/pdf",
              size: 5,
              isInline: false,
              sha256: "a".repeat(64),
              unavailableReason: "unsupported_attachment",
            },
          ],
        },
      ],
    };
    const fetcher = createSidecarOutlookMessageFetcher(
      context(fakeClient({ conversation }), inner),
    );

    const result = await fetcher.fetchConversationMessages("conv-1");

    expect(inner.fetchConversationMessages).not.toHaveBeenCalled();
    expect(result.state).toBe("partial");
    const attachment = result.messages[0].attachments![0];
    expect(attachment.id).toBeDefined();
    expect(attachment.contentBytes).toBeUndefined();
  });
});
