import { describe, expect, it, vi } from "vitest";

import { createSidecarOutlookMessageFetcher } from "../fetchOutlookMessageSidecar";

import type { DesktopSidecarClient } from "@erato/frontend/library";
import type { OutlookMessageFetcher } from "../fetchOutlookMessage";
import type { FetchConversationResult } from "../fetchOutlookMessageGraph";

const FALLBACK: FetchConversationResult = { messages: [], state: "error" };

function stubInner(): OutlookMessageFetcher {
  return {
    fetchMessageBytes: vi.fn(),
    fetchMessageFilesByInternetMessageId: vi.fn(),
    fetchMessageBytesByInternetMessageId: vi.fn(),
    fetchConversationMessages: vi.fn(async () => FALLBACK),
    fetchParentMessageInConversation: vi.fn(),
  } as unknown as OutlookMessageFetcher;
}

interface FakeClientOptions {
  supports?: boolean;
  mailboxes?: { id: string; emailAddress?: string }[];
  conversation?: unknown;
  transfer?: (handle: string) => Promise<Uint8Array>;
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
        bodyHandle: { handle: "body01", contentType: "text/html", size: 6 },
        attachments: [
          {
            name: "doc.pdf",
            contentType: "application/pdf",
            size: 5,
            isInline: false,
            sha256: "a".repeat(64),
            contentHandle: "att01",
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
    transfer = async (handle: string) => new TextEncoder().encode(handle),
  } = options;
  return {
    supports: () => supports,
    invoke: async (method: string) => {
      if (method === "outlook.list_mailboxes.v1") return { mailboxes };
      if (method === "outlook.get_conversation.v1") return conversation;
      throw new Error(`unexpected invoke ${method}`);
    },
    fetchTransfer: (handle: string) => transfer(handle),
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
  it("maps a conversation with fetchable body and attachment bytes", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(fakeClient(), inner),
    );

    const result = await fetcher.fetchConversationMessages("conv-1");

    expect(inner.fetchConversationMessages).not.toHaveBeenCalled();
    expect(result.state).toBe("ok");
    const message = result.messages[0];
    expect(message.internetMessageId).toBe("<a@b>");
    expect(message.body).toEqual({ contentType: "html", content: "body01" });

    const attachment = message.attachments![0];
    // The bug review caught: attachments must carry an id, or transformAttachment
    // drops them downstream — defeating the whole sidecar-attachments feature.
    expect(attachment.id).toBeDefined();
    expect(attachment.contentBytes).toBeDefined();
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

  it("degrades a failed attachment transfer to a marker + partial, not a full fallback", async () => {
    const inner = stubInner();
    const fetcher = createSidecarOutlookMessageFetcher(
      context(
        fakeClient({
          transfer: async (handle) => {
            if (handle === "att01") throw new Error("transfer failed");
            return new TextEncoder().encode(handle);
          },
        }),
        inner,
      ),
    );

    const result = await fetcher.fetchConversationMessages("conv-1");

    expect(inner.fetchConversationMessages).not.toHaveBeenCalled();
    expect(result.state).toBe("partial");
    const attachment = result.messages[0].attachments![0];
    expect(attachment.id).toBeDefined();
    expect(attachment.contentBytes).toBeUndefined();
  });
});
