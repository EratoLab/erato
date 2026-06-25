import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEmlBytes } from "../../utils/parsedEmail";
import {
  OutlookEmailSourceProvider,
  useOutlookEmailSource,
} from "../OutlookEmailSourceProvider";

import type { OutlookMessageFetcher } from "../../utils/fetchOutlookMessage";
import type { ParsedThread, ThreadMessage } from "../../utils/parsedThread";

// The provider only needs these three hooks; mocking them keeps the test off
// Office.js / MSAL / the network and lets us inject a fixed thread. Note
// there is deliberately NO Graph provider anywhere in this file — the
// provider must work (or quietly degrade) without one.
const mockUseCurrentThread = vi.fn();
const mockUseOutlookMailItem = vi.fn();
const mockUseOutlookMessageFetcher = vi.fn();

vi.mock("../OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../hooks/useCurrentThread", () => ({
  useCurrentThread: () => mockUseCurrentThread(),
}));

vi.mock("../../hooks/useOutlookMessageFetcher", () => ({
  useOutlookMessageFetcher: () => mockUseOutlookMessageFetcher(),
}));

function makeMessage(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "<m@x>",
    internetMessageId: "<m@x>",
    subject: "Project kickoff",
    from: { name: "Sender", address: "sender@x" },
    to: [],
    cc: [],
    date: "2026-03-01T10:00:00Z",
    bodyText: "body",
    bodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

function makeThread(): ParsedThread {
  return {
    conversationId: "conv-1",
    subject: "Project kickoff",
    messages: [
      makeMessage({ id: "<m1@x>", bodyText: "Let's start Monday." }),
      makeMessage({
        id: "<m2@x>",
        from: { name: "Anna", address: "anna@x" },
        bodyText: "I'll prepare the deck.",
        attachments: [
          {
            id: "<m2@x>:a1",
            filename: "Deck.pdf",
            mimeType: "application/pdf",
            size: 700,
            contentBytes: new Uint8Array(700).fill(0xab).buffer,
            isInline: false,
            contentId: null,
            unavailableReason: null,
          },
        ],
      }),
    ],
    incomplete: false,
  };
}

type ContextValue = ReturnType<typeof useOutlookEmailSource>;

let captured: ContextValue | null = null;

function Capture() {
  captured = useOutlookEmailSource();
  return null;
}

function renderProvider() {
  captured = null;
  render(
    <OutlookEmailSourceProvider>
      <Capture />
    </OutlookEmailSourceProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OutlookEmailSourceProvider — current-thread emailBodyFile", () => {
  function primeReadModeThread() {
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "id-1",
      // itemId set => read mode => the compose reply-context effect early-returns.
      mailItem: {
        itemId: "item-1",
        conversationId: "conv-1",
        internetMessageId: "<m2@x>",
        subject: "Project kickoff",
        isComposeMode: false,
      },
      attachments: [],
      isLoadingAttachments: false,
      getAttachmentFile: vi.fn(),
    });
    mockUseCurrentThread.mockReturnValue({
      thread: makeThread(),
      isLoading: false,
      isBlockingLoad: false,
      error: false,
    });
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: null,
      unavailableReason: "unsupported-mode",
    });
  }

  it("exposes the real synthesized .eml as emailBodyFile (real bytes, not a zero-filled placeholder)", async () => {
    primeReadModeThread();
    renderProvider();

    const file = captured!.emailBodyFile;
    expect(file).not.toBeNull();
    expect(captured!.isEmailBodyIncluded).toBe(true);

    const bytes = new Uint8Array(await file!.arrayBuffer());
    expect(bytes.some((byte) => byte !== 0)).toBe(true);

    const parsed = await parseEmlBytes(bytes.buffer);
    expect(parsed).not.toBeNull();
  });

  it("sends the exact same File it estimated — emailBodyFile IS the file resolveSelectedFilesForSend returns", async () => {
    primeReadModeThread();
    renderProvider();

    const estimateFile = captured!.emailBodyFile;
    expect(estimateFile).not.toBeNull();

    let sent: File[] = [];
    await act(async () => {
      sent = await captured!.resolveSelectedFilesForSend();
    });

    // The invariant the whole refactor exists for: the token estimate measures
    // byte-for-byte what is uploaded. They are not just equal — they are the
    // same File instance, so they cannot drift.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(estimateFile);
  });

  it("keeps the estimate=send identity after a dismissal toggle settles (deferred synthesis)", async () => {
    primeReadModeThread();
    renderProvider();

    // Dismiss one of two messages. This re-runs the (deferred) synthesis; once
    // act() flushes the deferred pass the file is settled, not stale.
    act(() => {
      captured!.dismissStagedEmailBody("<m1@x>");
    });

    expect(captured!.isThreadEmlStale).toBe(false);
    const estimateFile = captured!.emailBodyFile;
    expect(estimateFile).not.toBeNull();

    let sent: File[] = [];
    await act(async () => {
      sent = await captured!.resolveSelectedFilesForSend();
    });

    // The deferred recompute does not break the invariant: what we upload is
    // still the very File instance the estimate measured.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(estimateFile);
  });

  it("yields no emailBodyFile (and sends nothing) once every message is dismissed", async () => {
    primeReadModeThread();
    renderProvider();

    const messageIds = captured!.currentThread!.messages.map(
      (message) => message.id,
    );
    act(() => {
      messageIds.forEach((id) => captured!.dismissStagedEmailBody(id));
    });

    expect(captured!.emailBodyFile).toBeNull();
    expect(captured!.isEmailBodyIncluded).toBe(false);

    let sent: File[] = [];
    await act(async () => {
      sent = await captured!.resolveSelectedFilesForSend();
    });
    expect(sent).toHaveLength(0);
  });
});

describe("OutlookEmailSourceProvider — isBlockingLoadEmailBody", () => {
  it("forwards isBlockingLoad from useCurrentThread as isBlockingLoadEmailBody", () => {
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "id-1",
      mailItem: {
        itemId: "item-1",
        conversationId: "conv-1",
        internetMessageId: "<m1@x>",
        subject: "Test",
        isComposeMode: false,
      },
      attachments: [],
      isLoadingAttachments: false,
      getAttachmentFile: vi.fn(),
    });
    mockUseCurrentThread.mockReturnValue({
      thread: null,
      isLoading: true,
      isBlockingLoad: true,
      error: false,
    });
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: null,
      unavailableReason: "unsupported-mode",
    });

    renderProvider();

    expect(captured!.isLoadingEmailBody).toBe(true);
    expect(captured!.isBlockingLoadEmailBody).toBe(true);
  });

  it("exposes isBlockingLoadEmailBody=false when the block deadline has elapsed (isLoading still true)", () => {
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "id-1",
      mailItem: {
        itemId: "item-1",
        conversationId: "conv-1",
        internetMessageId: "<m1@x>",
        subject: "Test",
        isComposeMode: false,
      },
      attachments: [],
      isLoadingAttachments: false,
      getAttachmentFile: vi.fn(),
    });
    // Simulates the state after the UI-block deadline: still loading but
    // isBlockingLoad=false so the chat input is no longer disabled.
    mockUseCurrentThread.mockReturnValue({
      thread: null,
      isLoading: true,
      isBlockingLoad: false,
      error: false,
    });
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: null,
      unavailableReason: "unsupported-mode",
    });

    renderProvider();

    expect(captured!.isLoadingEmailBody).toBe(true);
    expect(captured!.isBlockingLoadEmailBody).toBe(false);
  });
});

describe("OutlookEmailSourceProvider — compose reply-context via the dispatched fetcher", () => {
  function primeComposeMode() {
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "id-2",
      // No itemId but a conversationId => the compose reply-context path.
      mailItem: {
        itemId: null,
        conversationId: "conv-9",
        internetMessageId: null,
        subject: "Re: Project kickoff",
        isComposeMode: true,
      },
      attachments: [],
      isLoadingAttachments: false,
      getAttachmentFile: vi.fn(),
    });
    mockUseCurrentThread.mockReturnValue({
      thread: null,
      isLoading: false,
      isBlockingLoad: false,
      error: false,
    });
  }

  // The SE crash regression (ERMAIN-353): before the dispatcher seam the
  // provider called the THROWING useGraphToken() at render time, so any
  // non-Graph host took the whole tree down. With no fetcher available it
  // must render and quietly skip the reply-context preview instead.
  it("renders without any Graph provider and quietly no-ops the reply context when the fetcher is null", () => {
    primeComposeMode();
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: null,
      unavailableReason: "unsupported-mode",
    });

    expect(() => renderProvider()).not.toThrow();

    expect(captured).not.toBeNull();
    expect(captured!.parentReplyContext).toBeNull();
    expect(captured!.isLoadingParentReplyContext).toBe(false);
  });

  it("loads the reply-context preview through the fetcher capability when one is available", async () => {
    primeComposeMode();
    const fetchParentMessageInConversation = vi.fn(async () => ({
      subject: "Re: Project kickoff",
      fromName: "Alice",
      fromAddress: "alice@x",
    }));
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: {
        fetchParentMessageInConversation,
      } as unknown as OutlookMessageFetcher,
      unavailableReason: null,
    });

    renderProvider();

    await waitFor(() => {
      expect(captured!.parentReplyContext).toEqual({
        subject: "Re: Project kickoff",
        fromName: "Alice",
        fromAddress: "alice@x",
      });
    });
    expect(fetchParentMessageInConversation).toHaveBeenCalledWith(
      "conv-9",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(captured!.isLoadingParentReplyContext).toBe(false);
  });
});
