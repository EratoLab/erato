import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinChatAddMenuExtraContent } from "../AddinChatAddMenuExtraContent";

import type { StagedEmail } from "../../providers/OutlookEmailSourceProvider";
import type { OutlookAttachmentData } from "../../providers/OutlookMailItemProvider";
import type {
  ParsedThread,
  ThreadAttachment,
  ThreadMessage,
} from "../../utils/parsedThread";

const state = vi.hoisted(() => ({
  host: "Outlook",
  currentChatId: null as string | null,
  messageOrder: [] as string[],
  attachments: [] as OutlookAttachmentData[],
  isLoadingAttachments: false,
  isLoadingEmailBody: false,
  emailThreadLoadError: null as string | null,
  emailBodyFile: null as File | null,
  isThreadEmlStale: false,
  isDropResolutionStale: false,
  isEmailBodyDismissed: false,
  dismissedAttachmentIds: [] as string[],
  getAttachmentFile: vi.fn(),
  restoreEmailBody: vi.fn(),
  restoreAttachment: vi.fn(),
  internetMessageId: null as string | null,
  currentThread: null as ParsedThread | null,
  stagedEmails: [] as StagedEmail[],
  threadTrimError: null as Error | null,
  restoreStagedEmailBody: vi.fn(),
  restoreStagedEmailAttachment: vi.fn(),
  dismissStagedEmailAttachment: vi.fn(),
  policyExcludedAttachmentIds: new Map<string, Set<string>>(),
}));

// The library is mocked at one seam only: the chat snapshot decides whether a
// row offers to restore or to upload. `Row` and `PopoverSectionHeader` stay
// real, because the rows' geometry and roving marker are what this suite is
// for — a stub would assert the stub.
vi.mock("@erato/frontend/library", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatContext: () => ({
    currentChatId: state.currentChatId,
    messageOrder: state.messageOrder,
  }),
}));
vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ host: state.host }),
}));
vi.mock("../../providers/OutlookMailItemProvider", () => ({
  useOutlookMailItem: () => ({
    mailItem: { internetMessageId: state.internetMessageId },
    attachments: state.attachments,
    isLoadingAttachments: state.isLoadingAttachments,
    getAttachmentFile: state.getAttachmentFile,
  }),
}));
vi.mock("../../providers/OutlookEmailSourceProvider", () => ({
  useOutlookEmailSource: () => ({
    emailBodyFile: state.emailBodyFile,
    isThreadEmlStale: state.isThreadEmlStale,
    isDropResolutionStale: state.isDropResolutionStale,
    isLoadingEmailBody: state.isLoadingEmailBody,
    emailThreadLoadError: state.emailThreadLoadError,
    isEmailBodyDismissed: state.isEmailBodyDismissed,
    dismissedAttachmentIds: state.dismissedAttachmentIds,
    restoreEmailBody: state.restoreEmailBody,
    restoreAttachment: state.restoreAttachment,
    threadTrimError: state.threadTrimError,
    currentThread: state.currentThread,
    stagedEmails: state.stagedEmails,
    restoreStagedEmailBody: state.restoreStagedEmailBody,
    restoreStagedEmailAttachment: state.restoreStagedEmailAttachment,
    dismissStagedEmailAttachment: state.dismissStagedEmailAttachment,
    policyExcludedAttachmentIds: state.policyExcludedAttachmentIds,
  }),
}));

const attachment: OutlookAttachmentData = {
  id: "att-1",
  name: "quarterly-report.pdf",
  size: 2048,
  isInline: false,
  attachmentType: "file",
  contentType: "application/pdf",
};

const onSelectFiles = () => Promise.resolve();

describe("AddinChatAddMenuExtraContent", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.host = "Outlook";
    state.currentChatId = "chat-1";
    state.messageOrder = [];
    state.attachments = [attachment];
    state.isLoadingAttachments = false;
    state.isLoadingEmailBody = false;
    state.emailThreadLoadError = null;
    state.emailBodyFile = new File(["thread"], "conversation.eml");
    state.isThreadEmlStale = false;
    state.isEmailBodyDismissed = false;
    state.dismissedAttachmentIds = [];
    state.internetMessageId = null;
    state.currentThread = null;
    state.stagedEmails = [];
    state.threadTrimError = null;
    state.policyExcludedAttachmentIds = new Map();
    state.getAttachmentFile.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("offers the thread and each attachment as a menu row", () => {
    render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByRole("menuitem", { name: /Email thread/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("menuitem", { name: /quarterly-report\.pdf/ }),
    ).toBeEnabled();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("disables the rows when the composer has no room or no upload path", () => {
    const { rerender } = render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
        uploadDisabled
      />,
    );
    expect(screen.getByTestId("addin-add-menu-email-thread")).toBeDisabled();
    expect(
      screen.getByTestId("addin-add-menu-attachment-att-1"),
    ).toBeDisabled();

    rerender(<AddinChatAddMenuExtraContent onClose={() => {}} />);
    expect(screen.getByTestId("addin-add-menu-email-thread")).toBeDisabled();
  });

  it("keeps the injected rows on the menu's roving marker", () => {
    render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    const row = screen.getByTestId("addin-add-menu-email-thread");
    // The add-menu roves over `[data-row-item]` and nothing else now, so the
    // retired hand-written `data-add-menu-item` marker would not reach these
    // rows: losing the shared one drops them out of keyboard navigation.
    expect(row).toHaveAttribute("data-row-item");
    expect(row).not.toHaveAttribute("data-add-menu-item");
    expect(row).toHaveAttribute("tabindex", "-1");
  });

  it("renders the status lines as inert rows with no hover or focus channel", () => {
    state.isLoadingEmailBody = true;
    state.emailBodyFile = null;
    state.attachments = [];
    const { container } = render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    const infoRow = screen.getByText("Loading email thread...");
    expect(infoRow.tagName).toBe("DIV");
    expect(infoRow).toHaveClass(
      "dropdown-item-geometry",
      "text-xs",
      "text-theme-fg-muted",
    );
    // A status line is not a menu item: no role, no tab stop, and none of the
    // interactive row's paint. `text-xs` outranks the row's `text-sm` because
    // it is emitted later in the stylesheet, not because of specificity.
    expect(infoRow).not.toHaveAttribute("role");
    expect(infoRow).not.toHaveAttribute("tabindex");
    // And no roving marker, which is the attribute that would matter most:
    // the "+" menu walks `[data-row-item]` and calls `.focus()` on what it
    // finds. A status line cannot take focus, so a marked one would stop the
    // walk dead on itself — and the thread-load error line is not transient.
    expect(infoRow).not.toHaveAttribute("data-row-item");
    expect(infoRow.className).not.toContain("hover:");
    expect(infoRow.className).not.toContain("focus:");
    expect(infoRow.className).not.toContain("cursor-pointer");
    expect(infoRow.className).not.toContain("theme-transition");
    expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });

  it("reports a failed thread load on an error-toned row", () => {
    state.emailThreadLoadError = "boom";
    state.emailBodyFile = null;
    render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    const errorRow = screen.getByText(/Couldn't load this conversation/);
    expect(errorRow).toHaveClass("text-theme-error-fg");
    expect(errorRow).toHaveAttribute("data-tone", "error");
    expect(errorRow.className).not.toContain("hover:");
  });

  it("holds the attachment rows from the click until Outlook hands the file over", async () => {
    let handOver: (file: File) => void = () => {};
    state.getAttachmentFile.mockImplementation(
      () =>
        new Promise<File>((resolve) => {
          handOver = resolve;
        }),
    );
    const upload = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <AddinChatAddMenuExtraContent onSelectFiles={upload} onClose={onClose} />,
    );

    const row = screen.getByTestId("addin-add-menu-attachment-att-1");
    fireEvent.click(row);
    expect(row).toBeDisabled();
    expect(screen.getByTestId("addin-add-menu-email-thread")).toBeDisabled();
    fireEvent.click(row);
    expect(state.getAttachmentFile).toHaveBeenCalledTimes(1);

    const file = new File(["report"], "quarterly-report.pdf");
    await act(async () => {
      handOver(file);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith([file]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says so in the menu when Outlook can't hand the attachment over", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.getAttachmentFile.mockRejectedValue(new Error("InternalError"));
    const upload = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    render(
      <AddinChatAddMenuExtraContent onSelectFiles={upload} onClose={onClose} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("addin-add-menu-attachment-att-1"));
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't load this attachment from Outlook. Try again.",
    );
    expect(alert).toHaveAttribute("data-tone", "error");
    expect(alert).not.toHaveAttribute("data-row-item");
    expect(upload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("addin-add-menu-attachment-att-1")).toBeEnabled();
  });

  it("renders nothing outside Outlook", () => {
    state.host = "Teams";
    const { container } = render(
      <AddinChatAddMenuExtraContent
        onSelectFiles={onSelectFiles}
        onClose={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  describe("with the open conversation staged", () => {
    const threadAttachment = (
      id: string,
      filename: string,
      size: number,
    ): ThreadAttachment => ({
      id,
      filename,
      mimeType: "application/pdf",
      size,
      contentBytes: null,
      isInline: false,
      contentId: null,
      unavailableReason: null,
    });
    const message = (
      id: string,
      attachments: ThreadAttachment[] = [],
    ): ThreadMessage => ({
      id,
      internetMessageId: id,
      subject: "Kickoff",
      from: null,
      to: [],
      cc: [],
      date: null,
      bodyText: "hi",
      bodyHtml: null,
      attachments,
    });
    const thread: ParsedThread = {
      conversationId: "conv-1",
      subject: "Re: Kickoff",
      incomplete: false,
      messages: [
        message("<earlier@x>"),
        message("<open@x>", [
          threadAttachment("<open@x>:a1", "quarterly-report.pdf", 2048),
          threadAttachment("<open@x>:a2", "appendix.pdf", 512),
        ]),
      ],
    };
    const stageThread = (
      dismissedMessageIds: string[],
      dismissedAttachmentIds: string[] = [],
    ) => {
      state.currentThread = thread;
      state.internetMessageId = "<open@x>";
      state.stagedEmails = [
        {
          key: "current-thread:conv-1",
          source: "current-thread",
          thread,
          dismissedMessageIds: new Set(dismissedMessageIds),
          dismissedAttachmentIds: new Set(dismissedAttachmentIds),
        },
      ];
      state.isEmailBodyDismissed =
        dismissedMessageIds.length === thread.messages.length;
      if (state.isEmailBodyDismissed) state.emailBodyFile = null;
    };
    const allMessages = ["<earlier@x>", "<open@x>"];
    const freshChat = () => {
      state.currentChatId = null;
    };
    const threadRow = () => screen.getByTestId("addin-add-menu-email-thread");
    const attachmentRow = () =>
      screen.getByTestId("addin-add-menu-attachment-att-1");

    it("restores a fully unticked thread on a fresh chat", () => {
      freshChat();
      stageThread(allMessages);
      const onClose = vi.fn();
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={onClose}
        />,
      );

      expect(threadRow()).toBeEnabled();
      expect(threadRow()).toHaveTextContent("Re: Kickoff");
      fireEvent.click(threadRow());
      expect(state.restoreEmailBody).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("reads a partly ticked thread as already added", () => {
      freshChat();
      stageThread(["<earlier@x>"]);
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(threadRow()).toBeDisabled();
      expect(threadRow()).toHaveTextContent("Already added");
    });

    it("reads an attachment from the thread's own ticks and restores it", () => {
      freshChat();
      stageThread([], ["<open@x>:a1"]);
      // The Office.js list says nothing about the thread card's ticks.
      state.dismissedAttachmentIds = [];
      const onClose = vi.fn();
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={onClose}
        />,
      );

      expect(attachmentRow()).toBeEnabled();
      fireEvent.click(attachmentRow());
      expect(state.restoreStagedEmailAttachment).toHaveBeenCalledWith(
        "<open@x>",
        "<open@x>:a1",
      );
      expect(state.restoreStagedEmailBody).not.toHaveBeenCalled();
      expect(state.restoreAttachment).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("brings back an unticked message with only the chosen attachment", () => {
      freshChat();
      stageThread(["<open@x>"]);
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(attachmentRow()).toBeEnabled();
      fireEvent.click(attachmentRow());
      expect(state.restoreStagedEmailBody).toHaveBeenCalledWith("<open@x>");
      expect(state.dismissStagedEmailAttachment.mock.calls).toEqual([
        ["<open@x>", "<open@x>:a2"],
      ]);
      expect(state.restoreStagedEmailAttachment).not.toHaveBeenCalled();
    });

    it("keeps the Office.js list for an attachment the thread does not have", () => {
      freshChat();
      stageThread([]);
      state.attachments = [
        { ...attachment, id: "att-2", name: "unrelated.docx", size: 9 },
      ];
      state.dismissedAttachmentIds = ["att-2"];
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      fireEvent.click(screen.getByTestId("addin-add-menu-attachment-att-2"));
      expect(state.restoreAttachment).toHaveBeenCalledWith("att-2");
      expect(state.restoreStagedEmailAttachment).not.toHaveBeenCalled();
    });

    it("uploads a restored thread on a follow-up chat once its file is rebuilt", async () => {
      stageThread(allMessages);
      const onClose = vi.fn();
      const upload = vi.fn(() => Promise.resolve());
      const ui = () => (
        <AddinChatAddMenuExtraContent
          onSelectFiles={upload}
          onClose={onClose}
        />
      );
      const { rerender } = render(ui());

      fireEvent.click(threadRow());
      expect(state.restoreEmailBody).toHaveBeenCalledTimes(1);
      expect(threadRow()).toHaveTextContent("Updating…");
      expect(upload).not.toHaveBeenCalled();

      // The restore lands; the deferred rebuild has not caught up yet.
      stageThread([]);
      state.emailBodyFile = null;
      state.isThreadEmlStale = true;
      rerender(ui());
      expect(upload).not.toHaveBeenCalled();

      const rebuilt = new File(["thread"], "conversation.eml");
      state.isThreadEmlStale = false;
      state.emailBodyFile = rebuilt;
      rerender(ui());
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(upload).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledWith([rebuilt]);
    });

    it.each([
      ["a trim error", { threadTrimError: new Error("trim") }],
      ["a settled pass without a file", {}],
    ])("stops waiting on %s without uploading", (_label, settled) => {
      stageThread(allMessages);
      const upload = vi.fn(() => Promise.resolve());
      const ui = () => (
        <AddinChatAddMenuExtraContent
          onSelectFiles={upload}
          onClose={() => {}}
        />
      );
      const { rerender } = render(ui());

      fireEvent.click(threadRow());
      expect(threadRow()).toHaveTextContent("Updating…");

      stageThread([]);
      state.emailBodyFile = null;
      Object.assign(state, settled);
      rerender(ui());

      // Ticked again but without a file, there is nothing left to offer.
      expect(screen.queryByTestId("addin-add-menu-email-thread")).toBeNull();
      expect(upload).not.toHaveBeenCalled();
    });

    it("offers no thread row on a follow-up chat while a ticked thread has no file", () => {
      stageThread(["<earlier@x>"]);
      // The deferred rebuild after a toggle has not produced the file yet.
      state.emailBodyFile = null;
      state.isThreadEmlStale = true;
      const upload = vi.fn(() => Promise.resolve());
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={upload}
          onClose={() => {}}
        />,
      );

      expect(screen.queryByTestId("addin-add-menu-email-thread")).toBeNull();
      expect(state.restoreEmailBody).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it("does not call a thread the send refuses already added", () => {
      freshChat();
      stageThread(["<earlier@x>"]);
      state.emailBodyFile = null;
      state.threadTrimError = new Error("trim");
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(screen.queryByTestId("addin-add-menu-email-thread")).toBeNull();
    });

    it("says a policy-excluded attachment is not read rather than added", () => {
      freshChat();
      stageThread([]);
      state.policyExcludedAttachmentIds = new Map([
        ["<open@x>", new Set(["<open@x>:a1"])],
      ]);
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(attachmentRow()).toBeDisabled();
      expect(attachmentRow()).toHaveTextContent("Won't be read by the AI");
      expect(attachmentRow()).not.toHaveTextContent("Already added");
    });

    it("leaves policy-excluded siblings alone when it brings a message back", () => {
      freshChat();
      stageThread(["<open@x>"]);
      state.policyExcludedAttachmentIds = new Map([
        ["<open@x>", new Set(["<open@x>:a2"])],
      ]);
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      fireEvent.click(attachmentRow());
      expect(state.restoreStagedEmailBody).toHaveBeenCalledWith("<open@x>");
      expect(state.dismissStagedEmailAttachment).not.toHaveBeenCalled();
    });

    it("restores the message and the attachment when both were unticked", () => {
      freshChat();
      stageThread(["<open@x>"], ["<open@x>:a1"]);
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={onSelectFiles}
          onClose={() => {}}
        />,
      );

      expect(attachmentRow()).toBeEnabled();
      fireEvent.click(attachmentRow());
      expect(state.restoreStagedEmailBody).toHaveBeenCalledWith("<open@x>");
      expect(state.restoreStagedEmailAttachment).toHaveBeenCalledWith(
        "<open@x>",
        "<open@x>:a1",
      );
      expect(state.dismissStagedEmailAttachment.mock.calls).toEqual([
        ["<open@x>", "<open@x>:a2"],
      ]);
    });

    it("only restores on a follow-up chat while a drop is staged", () => {
      stageThread(allMessages);
      state.stagedEmails = [
        ...state.stagedEmails,
        {
          key: "drop-1",
          source: "drop",
          parsed: {} as never,
          bodyDismissed: false,
          dismissedAttachmentIds: new Set(),
        },
      ];
      const onClose = vi.fn();
      const upload = vi.fn(() => Promise.resolve());
      render(
        <AddinChatAddMenuExtraContent
          onSelectFiles={upload}
          onClose={onClose}
        />,
      );

      fireEvent.click(threadRow());
      expect(state.restoreEmailBody).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(upload).not.toHaveBeenCalled();
    });
  });
});
