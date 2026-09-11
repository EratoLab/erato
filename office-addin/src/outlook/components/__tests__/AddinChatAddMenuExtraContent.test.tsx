import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinChatAddMenuExtraContent } from "../AddinChatAddMenuExtraContent";

import type { OutlookAttachmentData } from "../../providers/OutlookMailItemProvider";

const state = vi.hoisted(() => ({
  host: "Outlook",
  currentChatId: "chat-1",
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
  });
  afterEach(cleanup);

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
});
