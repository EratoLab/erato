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
import {
  OutlookComposerMenuContext,
  type OutlookComposerMenuState,
} from "../OutlookComposerMenuContext";

import type { StagedEmail } from "../../providers/OutlookEmailSourceProvider";
import type { OutlookAttachmentData } from "../../providers/OutlookMailItemProvider";
import type { ParsedThread } from "../../utils/parsedThread";
import type { ComponentProps } from "react";

const state = vi.hoisted(() => ({
  host: "Outlook",
  attachments: [] as OutlookAttachmentData[],
  isLoadingAttachments: false,
  getAttachmentFile: vi.fn(),
  internetMessageId: null as string | null,
  currentThread: null as ParsedThread | null,
  stagedEmails: [] as StagedEmail[],
  policyExcludedAttachmentIds: new Map<string, Set<string>>(),
  restoreEmailBody: vi.fn(),
  restoreAttachment: vi.fn(),
  restoreStagedEmailBody: vi.fn(),
  restoreStagedEmailAttachment: vi.fn(),
}));

// `Row` and `PopoverSectionHeader` stay real: the rows' geometry and roving
// marker are part of what this suite checks.
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
    currentThread: state.currentThread,
    stagedEmails: state.stagedEmails,
    policyExcludedAttachmentIds: state.policyExcludedAttachmentIds,
    // Restores belong to the chips now; the menu must never reach for them.
    restoreEmailBody: state.restoreEmailBody,
    restoreAttachment: state.restoreAttachment,
    restoreStagedEmailBody: state.restoreStagedEmailBody,
    restoreStagedEmailAttachment: state.restoreStagedEmailAttachment,
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

const menuState = (
  over: Partial<OutlookComposerMenuState> = {},
  thread: Partial<OutlookComposerMenuState["thread"]> = {},
): OutlookComposerMenuState => ({
  thread: {
    row: "in-composer",
    fileName: "conversation.eml",
    size: 2048,
    addAgain: vi.fn(),
    ...thread,
  },
  attachments: "in-composer",
  announce: vi.fn(),
  ...over,
});

function renderMenu(
  menu: OutlookComposerMenuState | null = menuState(),
  props: Partial<ComponentProps<typeof AddinChatAddMenuExtraContent>> = {},
) {
  const onSelectFiles = vi.fn(async () => {});
  const onClose = vi.fn();
  const ui = (
    <AddinChatAddMenuExtraContent
      onSelectFiles={onSelectFiles}
      onClose={onClose}
      {...props}
    />
  );
  const view = render(
    menu ? (
      <OutlookComposerMenuContext.Provider value={menu}>
        {ui}
      </OutlookComposerMenuContext.Provider>
    ) : (
      ui
    ),
  );
  return { ...view, onSelectFiles, onClose };
}

function expectNoRestore() {
  expect(state.restoreEmailBody).not.toHaveBeenCalled();
  expect(state.restoreAttachment).not.toHaveBeenCalled();
  expect(state.restoreStagedEmailBody).not.toHaveBeenCalled();
  expect(state.restoreStagedEmailAttachment).not.toHaveBeenCalled();
}

describe("AddinChatAddMenuExtraContent", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.host = "Outlook";
    state.attachments = [attachment];
    state.isLoadingAttachments = false;
    state.internetMessageId = null;
    state.currentThread = null;
    state.stagedEmails = [];
    state.policyExcludedAttachmentIds = new Map();
    state.getAttachmentFile.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("points at the chips for what is already in the composer", () => {
    renderMenu();

    const thread = screen.getByTestId("addin-add-menu-email-thread");
    expect(thread).toBeDisabled();
    expect(thread).toHaveTextContent("Already in the composer: use its chip");
    const row = screen.getByTestId("addin-add-menu-attachment-att-1");
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("Already in the composer: use its chip");

    fireEvent.click(thread);
    fireEvent.click(row);
    expectNoRestore();
    expect(state.getAttachmentFile).not.toHaveBeenCalled();
  });

  it("adds a thread already sent in this chat again, and says so", () => {
    const menu = menuState({}, { row: "add-again" });
    const { onClose, onSelectFiles } = renderMenu(menu);

    const thread = screen.getByTestId("addin-add-menu-email-thread");
    expect(thread).toBeEnabled();
    expect(thread).toHaveTextContent(
      "conversation.eml · already sent in this chat; add it again",
    );
    fireEvent.click(thread);

    expect(menu.thread.addAgain).toHaveBeenCalledTimes(1);
    expect(menu.announce).toHaveBeenCalledWith("Email thread included.");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectFiles).not.toHaveBeenCalled();
    expectNoRestore();
  });

  it("reads the open email staged as a drop as already added", () => {
    renderMenu(menuState({}, { row: "dropped" }));

    const thread = screen.getByTestId("addin-add-menu-email-thread");
    expect(thread).toBeDisabled();
    expect(thread).toHaveTextContent("Already added");
  });

  it.each([
    ["a follow-up's suggested thread", "in-composer"],
    ["a thread already sent in this chat", "add-again"],
  ] as const)(
    "uploads an attachment as its own file beside %s, which does not carry it",
    async (_name, row) => {
      const file = new File(["pdf"], "quarterly-report.pdf");
      state.getAttachmentFile.mockResolvedValue(file);
      const { onSelectFiles, onClose } = renderMenu(
        menuState({ attachments: "upload" }, { row }),
      );

      const attachmentRow = screen.getByTestId(
        "addin-add-menu-attachment-att-1",
      );
      expect(attachmentRow).toBeEnabled();
      fireEvent.click(attachmentRow);

      await waitFor(() => expect(onSelectFiles).toHaveBeenCalledWith([file]));
      expect(onClose).toHaveBeenCalled();
      expectNoRestore();
    },
  );

  it("uploads an attachment as its own file when the composer says no chip carries it", async () => {
    const file = new File(["pdf"], "quarterly-report.pdf");
    state.getAttachmentFile.mockResolvedValue(file);
    const { onSelectFiles, onClose } = renderMenu(
      menuState({ attachments: "upload" }, { row: "add-again" }),
    );

    const row = screen.getByTestId("addin-add-menu-attachment-att-1");
    expect(row).toBeEnabled();
    expect(row).toHaveTextContent("application/pdf");
    fireEvent.click(row);

    await waitFor(() => expect(onSelectFiles).toHaveBeenCalledWith([file]));
    expect(onClose).toHaveBeenCalled();
    expectNoRestore();
  });

  it("holds the attachment rows from the click until Outlook hands the file over", async () => {
    let handOver: (file: File) => void = () => {};
    state.getAttachmentFile.mockImplementation(
      () =>
        new Promise<File>((resolve) => {
          handOver = resolve;
        }),
    );
    const { onSelectFiles, onClose } = renderMenu(
      menuState({ attachments: "upload" }, { row: "add-again" }),
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
    expect(onSelectFiles).toHaveBeenCalledTimes(1);
    expect(onSelectFiles).toHaveBeenCalledWith([file]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says so in the menu when Outlook can't hand the attachment over", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.getAttachmentFile.mockRejectedValue(new Error("InternalError"));
    const { onSelectFiles, onClose } = renderMenu(
      menuState({ attachments: "upload" }),
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
    expect(onSelectFiles).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("addin-add-menu-attachment-att-1")).toBeEnabled();
  });

  it("keeps an upload row disabled when the composer has no room or no upload path", () => {
    const { rerender } = renderMenu(menuState({ attachments: "upload" }), {
      uploadDisabled: true,
    });
    expect(
      screen.getByTestId("addin-add-menu-attachment-att-1"),
    ).toBeDisabled();

    rerender(
      <OutlookComposerMenuContext.Provider
        value={menuState({ attachments: "upload" })}
      >
        <AddinChatAddMenuExtraContent onClose={() => {}} />
      </OutlookComposerMenuContext.Provider>,
    );
    expect(
      screen.getByTestId("addin-add-menu-attachment-att-1"),
    ).toBeDisabled();
  });

  it("keeps the cloud and policy reasons", () => {
    state.attachments = [
      {
        ...attachment,
        id: "cloud",
        name: "plan.docx",
        attachmentType: "cloud",
      },
      { ...attachment, id: "exe", name: "setup.exe" },
    ];
    state.internetMessageId = "<m1@x>";
    state.currentThread = {
      conversationId: "conv-1",
      subject: "Kickoff",
      incomplete: false,
      messages: [
        {
          id: "<m1@x>",
          internetMessageId: "<m1@x>",
          subject: "Kickoff",
          from: null,
          to: [],
          cc: [],
          date: null,
          bodyText: "",
          bodyHtml: null,
          attachments: [
            {
              id: "<m1@x>:exe",
              filename: "setup.exe",
              mimeType: "application/octet-stream",
              size: 2048,
              contentBytes: null,
              isInline: false,
              contentId: null,
              unavailableReason: null,
            },
          ],
        },
      ],
    };
    state.stagedEmails = [
      {
        key: "current-thread:conv-1",
        source: "current-thread",
        thread: state.currentThread,
        dismissedMessageIds: new Set(),
        dismissedAttachmentIds: new Set(),
      },
    ];
    state.policyExcludedAttachmentIds = new Map([
      ["<m1@x>", new Set(["<m1@x>:exe"])],
    ]);
    renderMenu(menuState({ attachments: "upload" }));

    const cloud = screen.getByTestId("addin-add-menu-attachment-cloud");
    expect(cloud).toBeDisabled();
    expect(cloud).toHaveTextContent(
      "Cloud attachment cannot be uploaded from Outlook",
    );
    const exe = screen.getByTestId("addin-add-menu-attachment-exe");
    expect(exe).toBeDisabled();
    expect(exe).toHaveTextContent("Won't be read by the AI");
  });

  it("keeps the rows on the menu's roving marker, and the loading line inert", () => {
    state.isLoadingAttachments = true;
    renderMenu();

    const row = screen.getByTestId("addin-add-menu-email-thread");
    // The add-menu roves over `[data-row-item]` and nothing else.
    expect(row).toHaveAttribute("data-row-item");
    expect(row).toHaveAttribute("tabindex", "-1");
    const loading = screen.getByText("Loading attachments...");
    expect(loading).not.toHaveAttribute("role");
    expect(loading).not.toHaveAttribute("data-row-item");
    // The thread's loading and failure belong to its chip, not the menu.
    expect(screen.queryByText(/Loading email thread/)).toBeNull();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("renders nothing outside the Outlook composer or without email content", () => {
    const { container, unmount } = renderMenu(null);
    expect(container).toBeEmptyDOMElement();
    unmount();

    state.host = "Teams";
    const teams = renderMenu();
    expect(teams.container).toBeEmptyDOMElement();
    teams.unmount();

    state.host = "Outlook";
    state.attachments = [];
    const empty = renderMenu(menuState({}, { row: "none" }));
    expect(empty.container).toBeEmptyDOMElement();
  });
});
