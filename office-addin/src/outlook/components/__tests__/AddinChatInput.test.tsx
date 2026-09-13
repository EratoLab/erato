import { UploadTooLargeError } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailTrimError } from "../../utils/trimRawEmlBytes";
import { AddinChatInput } from "../AddinChatInput";

import type {
  ResolvedDrop,
  ResolvedPart,
  StagedEmail,
} from "../../providers/OutlookEmailSourceProvider";
import type { ParsedEmail } from "../../utils/parsedEmail";
import type { ComponentProps, ReactNode } from "react";

// The composer and the preview are stubbed to what this suite reads: the
// props the wrapper hands down and the per-card actions it renders. Every
// hook the wrapper consults is mocked so a send can be driven end to end
// without Office, Graph, or a provider tree.
const h = vi.hoisted(() => {
  const uploadedFile = { id: "f1", filename: "notes.txt" };
  const chatInput: { props: Record<string, unknown> } = { props: {} };
  const emailSource: Record<string, unknown> = {};
  return {
    uploadedFile,
    controls: {
      setDraftMessage: vi.fn(),
      focusInput: vi.fn(),
      setSelectedFacetIds: vi.fn(),
      setSelectedChatProviderId: vi.fn(),
      toggleFacetId: vi.fn(),
      addUploadedFiles: vi.fn(),
      clearQueuedMessage: vi.fn(),
    },
    fileUploadState: { uploadedFiles: [uploadedFile], error: null },
    fetchUploadFile: vi.fn(),
    chatInput,
    emailSource,
    maxSizeBytes: 1000,
  };
});

vi.mock("@erato/frontend/library", () => {
  class UploadTooLargeError extends Error {
    readonly filenames: string[];
    constructor(maxSizeFormatted?: string, filenames: string[] = []) {
      super(`Too large for ${maxSizeFormatted}: ${filenames.join(", ")}`);
      this.filenames = filenames;
    }
  }
  class UploadUnknownError extends Error {
    constructor(message?: string) {
      super(`Upload failed: ${message}`);
    }
  }
  return {
    Button: (props: Record<string, unknown>) => <button {...props} />,
    ChatInput: (props: Record<string, unknown>) => {
      h.chatInput.props = props;
      const uploadError = props.uploadError;
      const sizeLimitExceeded = props.sizeLimitExceeded;
      return (
        <div
          data-testid="chat-input"
          data-upload-error={
            uploadError instanceof Error ? uploadError.message : ""
          }
          data-size-limit={
            sizeLimitExceeded ? JSON.stringify(sizeLimitExceeded) : ""
          }
        >
          <button
            type="button"
            onClick={() =>
              (
                props.onSendMessage as (
                  message: string,
                  inputFileIds?: string[],
                ) => void
              )("hello", ["f1"])
            }
          >
            send
          </button>
        </div>
      );
    },
    DEFAULT_MAX_FILES_PER_MESSAGE: 10,
    GroupedFileAttachmentsPreview: ({
      groups,
      groupActions,
    }: {
      groups: { id: string }[];
      groupActions?: Partial<Record<string, ReactNode>>;
    }) => (
      <div>
        {groups.map((group) => (
          <div key={group.id} data-testid={`group-${group.id}`}>
            {groupActions?.[group.id]}
          </div>
        ))}
      </div>
    ),
    SpinnerIcon: () => null,
    UploadTooLargeError,
    UploadUnknownError,
    fetchUploadFile: h.fetchUploadFile,
    formatFileSize: (bytes: number) => `${bytes} B`,
    getIdToken: () => null,
    isUploadTooLarge: (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      (error as { status?: unknown }).status === 413,
    useChatInputControls: () => h.controls,
    useChatInputFeature: () => ({ maxFiles: 10 }),
    useFileCapabilitiesContext: () => ({ capabilities: [], isLoading: false }),
    useFileUploadStore: Object.assign(
      (selector?: (state: typeof h.fileUploadState) => unknown) =>
        selector ? selector(h.fileUploadState) : h.fileUploadState,
      { getState: () => h.fileUploadState },
    ),
    useUploadFeature: () => ({
      enabled: true,
      maxSizeBytes: h.maxSizeBytes,
      maxSizeFormatted: "1 KB",
    }),
    validateFileSizes: (files: File[], maxBytes: number) => {
      const oversizedFiles = files.filter((file) => file.size > maxBytes);
      return { valid: oversizedFiles.length === 0, oversizedFiles };
    },
    // Transitive needs of the wrapper's helper modules.
    findCapabilityByExtension: () => null,
    hasSupportedOperations: () => false,
    htmlToPlainText: (html: string) => html,
  };
});

vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ host: "Outlook" }),
}));
vi.mock("../../hooks/useAvailableActionFacets", () => ({
  useAvailableActionFacetIds: () => new Set<string>(),
}));
vi.mock("../../hooks/useOutlookCalendarFetcher", () => ({
  useOutlookCalendarFetcher: () => ({
    fetcher: null,
    unavailableReason: null,
  }),
}));
vi.mock("../../hooks/useOutlookComposeSelection", () => ({
  useOutlookComposeSelection: () => ({ data: "", sourceProperty: "body" }),
}));
vi.mock("../../providers/OutlookMailItemProvider", () => ({
  NO_ITEM_SEND_IDENTITY: "no-item",
  readAppointmentComposeSnapshot: vi.fn(),
  useOutlookMailItem: () => ({ mailItem: null, itemIdentity: "item-1" }),
}));
vi.mock("../../providers/OutlookEmailSourceProvider", () => ({
  useOutlookEmailSource: () => h.emailSource,
}));

const emlBytes = new TextEncoder().encode(
  "Subject: Quarterly\r\n\r\nhi",
).buffer;
const emlFile = new File([emlBytes], "quarterly.eml", {
  type: "message/rfc822",
});

function droppedEmail(): ParsedEmail {
  return {
    rawBytes: emlBytes,
    rawEmlFile: emlFile,
    messageId: "<quarterly@x>",
    subject: "Quarterly",
    from: null,
    to: [],
    cc: [],
    bcc: [],
    date: null,
    text: "hi",
    html: null,
    attachments: [],
  };
}

const DROP_KEY = "drop-1";

function stagedDrop(): StagedEmail {
  return {
    key: DROP_KEY,
    source: "drop",
    parsed: droppedEmail(),
    bodyDismissed: false,
    dismissedAttachmentIds: new Set(),
  };
}

function stageDrop(size = emlFile.size) {
  const resolvedDrop: ResolvedDrop = { key: DROP_KEY, file: emlFile, size };
  const resolvedPart: ResolvedPart = {
    key: DROP_KEY,
    name: emlFile.name,
    size,
  };
  Object.assign(h.emailSource, {
    stagedEmails: [stagedDrop()],
    resolvedDrops: [resolvedDrop],
    resolvedFiles: [emlFile],
    resolvedParts: [resolvedPart],
    resolvedTotalBytes: size,
  });
}

function unstageDrops() {
  Object.assign(h.emailSource, {
    stagedEmails: [],
    resolvedDrops: [],
    resolvedFiles: [],
    resolvedParts: [],
    resolvedTotalBytes: 0,
  });
}

function renderInput() {
  const onSendMessage = vi.fn();
  const onEmailSourceDropsSent = vi.fn();
  // A fresh element per render, or React bails out on the unchanged props.
  const ui = (props: Partial<ComponentProps<typeof AddinChatInput>> = {}) => (
    <AddinChatInput
      onSendMessage={onSendMessage}
      onEmailSourceDropsSent={onEmailSourceDropsSent}
      {...props}
    />
  );
  return { ...render(ui()), ui, onSendMessage, onEmailSourceDropsSent };
}

function send() {
  fireEvent.click(screen.getByRole("button", { name: "send" }));
}

function uploadErrorText() {
  return screen.getByTestId("chat-input").getAttribute("data-upload-error");
}

async function expectDeclinedSend(onSendMessage: ReturnType<typeof vi.fn>) {
  await waitFor(() =>
    expect(h.controls.setDraftMessage).toHaveBeenCalledWith("hello", {
      focus: true,
    }),
  );
  expect(h.controls.addUploadedFiles).toHaveBeenCalledWith([h.uploadedFile]);
  expect(onSendMessage).not.toHaveBeenCalled();
}

describe("AddinChatInput", () => {
  beforeEach(() => {
    i18n.activate("en");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (
      Office as unknown as { context: Record<string, unknown> }
    ).context.mailbox = { item: null };
    Object.assign(h.emailSource, {
      emailSubject: "",
      isEmailBodyIncluded: false,
      emailBodyFile: null,
      isThreadEmlStale: false,
      isDropResolutionStale: false,
      isLoadingEmailBody: false,
      emailThreadLoadError: false,
      currentThread: null,
      dismissStagedEmailBody: vi.fn(),
      restoreStagedEmailBody: vi.fn(),
      dismissStagedEmailAttachment: vi.fn(),
      restoreStagedEmailAttachment: vi.fn(),
      setPolicyExcludedAttachmentIds: vi.fn(),
      addDroppedEmail: vi.fn(),
      removeDroppedEmail: vi.fn(),
      selectedAttachmentItems: [],
      isLoadingAttachments: false,
      removeEmailBody: vi.fn(),
      removeAttachment: vi.fn(),
      restoreEmailBody: vi.fn(),
      restoreAttachment: vi.fn(),
      isEmailBodyDismissed: false,
      dismissedAttachmentIds: [],
      resolveSelectedFilesForSend: vi.fn(async () => [emlFile]),
      hasSelectedEmailSource: true,
      parentReplyContext: null,
      isLoadingParentReplyContext: false,
    });
    stageDrop();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("sends the uploaded email ids with the message and releases the drop", async () => {
    h.fetchUploadFile.mockResolvedValueOnce({ files: [{ id: "u1" }] });
    const { onSendMessage, onEmailSourceDropsSent } = renderInput();

    send();

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    const [message, inputFileIds, , , , sendItemIdentity] =
      onSendMessage.mock.calls[0];
    expect(message).toBe("hello");
    expect(inputFileIds).toEqual(["f1", "u1"]);
    expect(sendItemIdentity).toBe("item-1");
    expect(onEmailSourceDropsSent).toHaveBeenCalledWith([
      { key: DROP_KEY, messageId: "<quarterly@x>" },
    ]);
    expect(h.controls.setDraftMessage).not.toHaveBeenCalled();
    expect(uploadErrorText()).toBe("");
  });

  it("keeps the draft and surfaces the failure when the upload rejects", async () => {
    h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
    const { onSendMessage, onEmailSourceDropsSent } = renderInput();

    send();

    await expectDeclinedSend(onSendMessage);
    expect(onEmailSourceDropsSent).not.toHaveBeenCalled();
    expect(uploadErrorText()).toContain(
      "Couldn't upload quarterly.eml. The message was not sent.",
    );
  });

  it("treats a 413 as a size failure naming the attempted files", async () => {
    h.fetchUploadFile.mockRejectedValueOnce({ status: 413 });
    const { onSendMessage } = renderInput();

    send();

    await expectDeclinedSend(onSendMessage);
    const error = h.chatInput.props.uploadError;
    expect(error).toBeInstanceOf(UploadTooLargeError);
    expect((error as UploadTooLargeError).filenames).toEqual(["quarterly.eml"]);
  });

  it("refuses the send when the dismissed attachments cannot be left out", async () => {
    (
      h.emailSource.resolveSelectedFilesForSend as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new EmailTrimError("quarterly.eml"));
    const { onSendMessage } = renderInput();

    send();

    await expectDeclinedSend(onSendMessage);
    expect(h.fetchUploadFile).not.toHaveBeenCalled();
    expect(uploadErrorText()).toContain(
      "Couldn't leave out the unchecked attachments of quarterly.eml.",
    );
  });

  it("blocks the composer on a resolved part over the upload limit", () => {
    stageDrop(h.maxSizeBytes + 1);

    renderInput();

    expect(h.chatInput.props.sizeLimitExceeded).toEqual({
      names: ["quarterly.eml"],
      formatted: "1 KB",
      kind: "size",
    });
  });

  it("lets the user remove a dropped email from its card", () => {
    const { onEmailSourceDropsSent } = renderInput();

    fireEvent.click(
      screen.getByTestId(`addin-staged-email-remove-${DROP_KEY}`),
    );

    expect(onEmailSourceDropsSent).toHaveBeenCalledWith([
      { key: DROP_KEY, messageId: "<quarterly@x>" },
    ]);
  });

  it("clears the failure once the drop it named is gone", async () => {
    h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
    const { onSendMessage, rerender, ui } = renderInput();
    send();
    await expectDeclinedSend(onSendMessage);
    expect(uploadErrorText()).not.toBe("");

    unstageDrops();
    rerender(ui());

    await waitFor(() => expect(uploadErrorText()).toBe(""));
  });

  it("keeps showing the failure while the owner has no newer error", async () => {
    h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
    const { onSendMessage, rerender, ui } = renderInput();
    send();
    await expectDeclinedSend(onSendMessage);

    rerender(ui({ uploadError: null }));

    expect(uploadErrorText()).toContain("Couldn't upload quarterly.eml.");
  });

  it("yields to an owner error raised after the failure", async () => {
    h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
    const { onSendMessage, rerender, ui } = renderInput();
    send();
    await expectDeclinedSend(onSendMessage);

    const ownerError = new Error("x.zip cannot be processed");
    rerender(ui({ uploadError: ownerError }));

    await waitFor(() => expect(h.chatInput.props.uploadError).toBe(ownerError));
  });
});
