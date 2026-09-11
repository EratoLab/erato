import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEmlBytes } from "../../utils/parsedEmail";
import { EmailTrimError } from "../../utils/trimRawEmlBytes";
import {
  OutlookEmailSourceProvider,
  useOutlookEmailSource,
} from "../OutlookEmailSourceProvider";

import type { OutlookMessageFetcher } from "../../utils/fetchOutlookMessage";
import type { ParsedEmail } from "../../utils/parsedEmail";
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
  useCurrentThread: (...args: unknown[]) => mockUseCurrentThread(...args),
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
/** `isDropResolutionStale` per committed render, oldest first. */
let dropStaleHistory: boolean[] = [];

function Capture() {
  captured = useOutlookEmailSource();
  dropStaleHistory.push(captured.isDropResolutionStale);
  return null;
}

function renderProvider() {
  captured = null;
  dropStaleHistory = [];
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

describe("OutlookEmailSourceProvider — appointment isolation", () => {
  it("does not present an appointment description or attachments as email context", async () => {
    const getAttachmentFile = vi.fn();
    const fetchParentMessageInConversation = vi.fn();
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "appointment:1",
      mailItem: {
        itemKind: "appointment",
        itemId: "saved-appointment",
        conversationId: "must-not-be-used",
        subject: "Planning session",
        isComposeMode: true,
      },
      attachments: [
        {
          id: "agenda",
          name: "agenda.pdf",
          isInline: false,
          attachmentType: "file",
        },
      ],
      isLoadingAttachments: true,
      getAttachmentFile,
    });
    mockUseCurrentThread.mockReturnValue({
      thread: null,
      isLoading: false,
      error: false,
    });
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: { fetchParentMessageInConversation },
      unavailableReason: null,
    });

    renderProvider();

    expect(mockUseCurrentThread).toHaveBeenCalledWith(null, null, null);
    expect(captured!.emailSubject).toBe("");
    expect(captured!.selectedAttachmentItems).toEqual([]);
    expect(captured!.isLoadingAttachments).toBe(false);
    expect(captured!.parentReplyContext).toBeNull();
    expect(fetchParentMessageInConversation).not.toHaveBeenCalled();

    let files: File[] = [];
    await act(async () => {
      files = await captured!.resolveSelectedFilesForSend();
    });
    expect(files).toEqual([]);
    expect(getAttachmentFile).not.toHaveBeenCalled();
  });
});

describe("OutlookEmailSourceProvider — dropped email resolution", () => {
  const CRLF = "\r\n";

  function emlWithOneAttachment(): string {
    const b = "----B";
    return (
      `Subject: Dropped${CRLF}` +
      `Message-ID: <drop-1@x>${CRLF}` +
      `Content-Type: multipart/mixed; boundary="${b}"${CRLF}${CRLF}` +
      `--${b}${CRLF}` +
      `Content-Type: text/plain${CRLF}${CRLF}` +
      `body${CRLF}` +
      `--${b}${CRLF}` +
      `Content-Type: application/pdf; name="a.pdf"${CRLF}` +
      `Content-Disposition: attachment; filename="a.pdf"${CRLF}${CRLF}` +
      `PDF-BYTES-PDF-BYTES${CRLF}` +
      `--${b}--${CRLF}`
    );
  }

  async function parseDrop(): Promise<ParsedEmail> {
    const bytes = new TextEncoder().encode(emlWithOneAttachment());
    const parsed = await parseEmlBytes(bytes.buffer, {
      filename: "drop.eml",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.attachments).toHaveLength(1);
    return parsed!;
  }

  function untrimmableDrop(): ParsedEmail {
    const rawBytes = new TextEncoder().encode("this is not an email").buffer;
    return {
      rawBytes,
      rawEmlFile: new File([rawBytes], "broken.eml", {
        type: "message/rfc822",
      }),
      messageId: "<broken@x>",
      subject: "Broken",
      from: null,
      to: [],
      cc: [],
      bcc: [],
      date: null,
      text: "this is not an email",
      html: null,
      attachments: [
        {
          id: "att-0",
          filename: "ghost.pdf",
          mimeType: "application/pdf",
          size: 3,
          disposition: "attachment",
          related: false,
          contentId: null,
          toFile: () => new File([], "ghost.pdf"),
        },
      ],
    };
  }

  // No thread: compose mode with no Graph fetcher, so the only staged
  // emails are the drops added below.
  function primeDropOnly() {
    mockUseOutlookMailItem.mockReturnValue({
      itemIdentity: "id-3",
      mailItem: {
        itemId: null,
        conversationId: null,
        internetMessageId: null,
        subject: "New message",
        isComposeMode: true,
      },
      attachments: [],
      isLoadingAttachments: false,
      getAttachmentFile: vi.fn(),
    });
    mockUseCurrentThread.mockReturnValue({
      thread: null,
      isLoading: false,
      error: false,
    });
    mockUseOutlookMessageFetcher.mockReturnValue({
      fetcher: null,
      unavailableReason: "unsupported-mode",
    });
  }

  it("resolves an untouched drop to its original File and re-trims it once an attachment is dismissed", async () => {
    primeDropOnly();
    const parsed = await parseDrop();
    renderProvider();

    let key: string | null = null;
    act(() => {
      key = captured!.addDroppedEmail(parsed);
    });
    expect(key).toBe("<drop-1@x>");

    expect(captured!.isDropResolutionStale).toBe(false);
    expect(captured!.resolvedDrops).toHaveLength(1);
    expect(captured!.resolvedDrops[0].file).toBe(parsed.rawEmlFile);
    expect(captured!.resolvedDrops[0].size).toBe(parsed.rawEmlFile.size);
    expect(captured!.resolvedParts).toEqual([
      { key: "<drop-1@x>", name: "drop.eml", size: parsed.rawEmlFile.size },
    ]);
    expect(captured!.resolvedTotalBytes).toBe(parsed.rawEmlFile.size);

    act(() => {
      captured!.dismissStagedEmailAttachment("<drop-1@x>", "att-0");
    });

    expect(captured!.isDropResolutionStale).toBe(false);
    const trimmed = captured!.resolvedDrops[0];
    expect(trimmed.file).not.toBe(parsed.rawEmlFile);
    expect(trimmed.size).toBeLessThan(parsed.rawEmlFile.size);
    expect(trimmed.size).toBe(trimmed.file!.size);
    expect(trimmed.file!.name).toBe("drop.eml");
    expect(trimmed.file!.lastModified).toBe(parsed.rawEmlFile.lastModified);
    expect(await trimmed.file!.text()).not.toContain("a.pdf");
    expect(captured!.resolvedTotalBytes).toBe(trimmed.size);
    // The original stays untouched for a later restore.
    expect(await parsed.rawEmlFile.text()).toContain("a.pdf");
  });

  it("sends the exact same trimmed File it estimated", async () => {
    primeDropOnly();
    const parsed = await parseDrop();
    renderProvider();

    act(() => {
      captured!.addDroppedEmail(parsed);
      captured!.dismissStagedEmailAttachment("<drop-1@x>", "att-0");
    });

    const estimateFile = captured!.resolvedDrops[0].file;
    expect(estimateFile).not.toBeNull();
    expect(captured!.resolvedFiles).toEqual([estimateFile]);
    expect(captured!.emailBodyFile).toBe(estimateFile);

    let sent: File[] = [];
    await act(async () => {
      sent = await captured!.resolveSelectedFilesForSend();
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(estimateFile);
    // A second send without any toggle reuses the same minted File.
    expect(captured!.resolvedDrops[0].file).toBe(estimateFile);
  });

  it("flags the resolution as stale between the toggle commit and the deferred re-trim", async () => {
    primeDropOnly();
    const parsed = await parseDrop();
    renderProvider();

    act(() => {
      captured!.addDroppedEmail(parsed);
    });
    dropStaleHistory = [];

    act(() => {
      captured!.dismissStagedEmailAttachment("<drop-1@x>", "att-0");
    });

    // The urgent render commits with the previous resolution (stale), then the
    // deferred pass catches up and settles on the trimmed file.
    expect(dropStaleHistory[0]).toBe(true);
    expect(dropStaleHistory.at(-1)).toBe(false);
    expect(captured!.isDropResolutionStale).toBe(false);
  });

  it("drops a dismissed body from the resolved files without an error", async () => {
    primeDropOnly();
    const parsed = await parseDrop();
    renderProvider();

    act(() => {
      captured!.addDroppedEmail(parsed);
      captured!.dismissStagedEmailBody("<drop-1@x>");
    });

    expect(captured!.resolvedDrops).toEqual([
      { key: "<drop-1@x>", file: null, size: 0 },
    ]);
    expect(captured!.resolvedFiles).toEqual([]);
    expect(captured!.resolvedParts).toEqual([]);
    expect(captured!.resolvedTotalBytes).toBe(0);
    // The "+" menu keeps its restore row on the original file.
    expect(captured!.emailBodyFile).toBe(parsed.rawEmlFile);
    expect(captured!.isEmailBodyDismissed).toBe(true);

    let sent: File[] = [];
    await act(async () => {
      sent = await captured!.resolveSelectedFilesForSend();
    });
    expect(sent).toEqual([]);
  });

  it("exposes a failed trim on the resolved drop and only throws it at send", async () => {
    primeDropOnly();
    const parsed = untrimmableDrop();
    renderProvider();

    expect(() =>
      act(() => {
        captured!.addDroppedEmail(parsed);
        captured!.dismissStagedEmailAttachment("<broken@x>", "att-0");
      }),
    ).not.toThrow();

    const failed = captured!.resolvedDrops[0];
    expect(failed.file).toBeNull();
    expect(failed.size).toBe(0);
    expect(failed.error).toBeInstanceOf(EmailTrimError);
    expect(failed.error!.filename).toBe("broken.eml");
    expect(captured!.resolvedParts).toEqual([]);
    expect(captured!.resolvedTotalBytes).toBe(0);

    await expect(captured!.resolveSelectedFilesForSend()).rejects.toBe(
      failed.error,
    );

    // Restoring the attachment clears the error and ships the original.
    act(() => {
      captured!.restoreStagedEmailAttachment("<broken@x>", "att-0");
    });
    expect(captured!.resolvedDrops[0].error).toBeUndefined();
    expect(captured!.resolvedDrops[0].file).toBe(parsed.rawEmlFile);
  });
});
