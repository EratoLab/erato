import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEmlBytes } from "../../utils/parsedEmail";
import {
  OutlookEmailSourceProvider,
  useOutlookEmailSource,
} from "../OutlookEmailSourceProvider";

import type { ParsedThread, ThreadMessage } from "../../utils/parsedThread";

// The provider only needs these three hooks; mocking them keeps the test off
// Office.js / MSAL / Graph and lets us inject a fixed thread.
const mockUseCurrentThread = vi.fn();
const mockUseOutlookMailItem = vi.fn();

vi.mock("../EntraGraphTokenProvider", () => ({
  useGraphToken: () => ({ acquireToken: vi.fn() }),
}));

vi.mock("../OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => mockUseOutlookMailItem(),
}));

vi.mock("../../hooks/useCurrentThread", () => ({
  useCurrentThread: () => mockUseCurrentThread(),
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
      error: false,
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
