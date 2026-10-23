import { UploadTooLargeError } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEDULING_THREAD_MAX_AGE_MS } from "../../utils/outlookScheduleTool";
import { EmailTrimError } from "../../utils/trimRawEmlBytes";
import { AddinChatInput } from "../AddinChatInput";

import type {
  ResolvedDrop,
  ResolvedPart,
  StagedEmail,
} from "../../providers/OutlookEmailSourceProvider";
import type { ParsedEmail } from "../../utils/parsedEmail";
import type { FileAttachmentGroup } from "@erato/frontend/library";
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
    mailItem: null as Record<string, unknown> | null,
    itemIdentity: "item-1",
    composeSelection: { data: "", sourceProperty: "body" },
    calendarFetcher: null as object | null,
    readAppointmentComposeSnapshot: vi.fn(),
    groups: [] as FileAttachmentGroup[],
    capabilities: [] as unknown[],
    availableFacetArgs: new Map<string, Set<string>>(),
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
      groups: FileAttachmentGroup[];
      groupActions?: Partial<Record<string, ReactNode>>;
    }) => {
      h.groups = groups;
      return (
        <div>
          {groups.map((group) => (
            <div
              key={group.id}
              data-testid={`group-${group.id}`}
              data-pin-actions={group.pinActions ? "true" : undefined}
            >
              {groupActions?.[group.id]}
            </div>
          ))}
        </div>
      );
    },
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
    useFileCapabilitiesContext: () => ({
      capabilities: h.capabilities,
      isLoading: false,
    }),
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
vi.mock("../../../core/clientActions/useAvailableActionFacets", () => ({
  useAvailableActionFacetIds: () => new Set(h.availableFacetArgs.keys()),
  useAvailableActionFacetArgs: () => h.availableFacetArgs,
}));
vi.mock("../../hooks/useOutlookCalendarFetcher", () => ({
  useOutlookCalendarFetcher: () => ({
    fetcher: h.calendarFetcher,
    unavailableReason: null,
  }),
}));
vi.mock("../../hooks/useOutlookComposeSelection", () => ({
  useOutlookComposeSelection: () => h.composeSelection,
}));
vi.mock("../../providers/OutlookMailItemProvider", () => ({
  NO_ITEM_SEND_IDENTITY: "no-item",
  readAppointmentComposeSnapshot: h.readAppointmentComposeSnapshot,
  useOutlookMailItem: () => ({
    mailItem: h.mailItem,
    itemIdentity: h.itemIdentity,
  }),
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

function renderInput(
  initial: Partial<ComponentProps<typeof AddinChatInput>> = {},
) {
  const onSendMessage = vi.fn();
  const onEmailSourceDropsSent = vi.fn();
  // A fresh element per render, or React bails out on the unchanged props.
  const ui = (props: Partial<ComponentProps<typeof AddinChatInput>> = {}) => (
    <AddinChatInput
      onSendMessage={onSendMessage}
      onEmailSourceDropsSent={onEmailSourceDropsSent}
      {...initial}
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
    h.mailItem = null;
    h.itemIdentity = "item-1";
    h.composeSelection = { data: "", sourceProperty: "body" };
    h.calendarFetcher = null;
    h.groups = [];
    h.capabilities = [];
    h.availableFacetArgs = new Map();
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
      removeAttachment: vi.fn(),
      restoreEmailBody: vi.fn(),
      restoreAttachment: vi.fn(),
      isEmailBodyDismissed: false,
      dismissedAttachmentIds: [],
      resolveSelectedFilesForSend: vi.fn(async () => [emlFile]),
      getFileProvenance: vi.fn(() => undefined),
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

  it("reads live compose recipients and sends them with the compose facet", async () => {
    h.mailItem = {
      itemKind: "message",
      isComposeMode: true,
      bodyText: "",
      subject: "",
    };
    h.availableFacetArgs = new Map([
      ["compose_email", new Set(["recipients"])],
    ]);
    const recipient = { displayName: "Mark", emailAddress: "mark@example.com" };
    const getAsync = vi.fn((callback) =>
      callback({
        status: Office.AsyncResultStatus.Succeeded,
        value: [recipient],
      }),
    );
    (Office.context.mailbox as unknown as { item: unknown }).item = {
      subject: {},
      to: { getAsync },
      body: {
        getTypeAsync: (callback: (result: unknown) => void) =>
          callback({
            status: Office.AsyncResultStatus.Succeeded,
            value: Office.CoercionType.Text,
          }),
      },
    };
    h.fetchUploadFile.mockResolvedValueOnce({ files: [{ id: "u1" }] });
    const { onSendMessage } = renderInput();
    fireEvent.click(screen.getByText("send"));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(getAsync).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0][4]).toEqual({
      id: "compose_email",
      args: {
        body_format: "text",
        recipients: JSON.stringify({ to: [recipient] }),
      },
    });
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

  it("uploads different email sources separately and places provenance before bytes", async () => {
    const otherFile = new File(["unrelated mail"], emlFile.name);
    const provenance = {
      version: 1,
      origins: [
        {
          document: {
            external_ids: [{ key: "ews_id", value: "current-thread" }],
          },
        },
      ],
    };
    (
      h.emailSource.resolveSelectedFilesForSend as ReturnType<typeof vi.fn>
    ).mockResolvedValue([emlFile, otherFile]);
    (
      h.emailSource.getFileProvenance as ReturnType<typeof vi.fn>
    ).mockImplementation((file: File) =>
      file === emlFile ? provenance : undefined,
    );
    h.fetchUploadFile
      .mockResolvedValueOnce({ files: [{ id: "thread-upload" }] })
      .mockResolvedValueOnce({ files: [{ id: "drop-upload" }] });
    const { onSendMessage } = renderInput();
    send();
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    const first = h.fetchUploadFile.mock.calls[0][0].body as FormData;
    const second = h.fetchUploadFile.mock.calls[1][0].body as FormData;
    expect([...first.keys()]).toEqual(["outlook_provenance", "file"]);
    expect(JSON.parse(first.get("outlook_provenance") as string)).toEqual(
      provenance,
    );
    expect([...second.keys()]).toEqual(["file"]);
    expect(onSendMessage.mock.calls[0][1]).toEqual([
      "f1",
      "thread-upload",
      "drop-upload",
    ]);
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

  it("names the paused Reply and Send on the write switch", () => {
    renderInput();

    // The action facet rides along implicitly from this composer, so the
    // Outlook build is the one host whose toggle must name the consequence.
    expect(h.chatInput.props.pausesHostActionsWhenWritesOff).toBe(true);
  });

  it("carries a new chat's writes-off seed through to the host send", async () => {
    h.fetchUploadFile.mockResolvedValueOnce({ files: [{ id: "u1" }] });
    const { onSendMessage } = renderInput();

    (
      h.chatInput.props.onSendMessage as (
        message: string,
        inputFileIds?: string[],
        modelId?: string,
        selectedFacetIds?: string[],
        mentionedAssistants?: { id: string; name: string }[],
        delegationRunMode?: "wait" | "background",
        mcpWriteToolsEnabled?: boolean,
      ) => void
    )(
      "read only please",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );

    // Ninth slot: after the action facet and the item identity the wrapper
    // inserts, and after the mentions and run mode it hands on unchanged.
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage.mock.calls[0]?.[8]).toBe(false);
    expect(onSendMessage.mock.calls[0]?.[5]).toBe("item-1");
  });

  it("carries a new chat's switched-off servers through to the host send", async () => {
    h.fetchUploadFile.mockResolvedValueOnce({ files: [{ id: "u1" }] });
    const { onSendMessage } = renderInput();

    (
      h.chatInput.props.onSendMessage as (
        message: string,
        inputFileIds?: string[],
        modelId?: string,
        selectedFacetIds?: string[],
        mentionedAssistants?: { id: string; name: string }[],
        delegationRunMode?: "wait" | "background",
        mcpWriteToolsEnabled?: boolean,
        disabledMcpServerIds?: string[],
      ) => void
    )(
      "without linear",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["linear"],
    );

    // Tenth slot: right after the write seed.
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage.mock.calls[0]?.[9]).toEqual(["linear"]);
    expect(onSendMessage.mock.calls[0]?.[8]).toBeUndefined();
  });

  it("carries a new chat's switched-off tools seed through to the host send", async () => {
    h.fetchUploadFile.mockResolvedValueOnce({ files: [{ id: "u1" }] });
    const { onSendMessage } = renderInput();

    (
      h.chatInput.props.onSendMessage as (
        message: string,
        inputFileIds?: string[],
        modelId?: string,
        selectedFacetIds?: string[],
        mentionedAssistants?: { id: string; name: string }[],
        delegationRunMode?: "wait" | "background",
        mcpWriteToolsEnabled?: boolean,
        disabledMcpServerIds?: string[],
        disabledMcpTools?: string[],
      ) => void
    )(
      "without issue creation",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["linear/create_issue"],
    );

    // Eleventh slot: right after the servers seed.
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage.mock.calls[0]?.[10]).toEqual(["linear/create_issue"]);
    expect(onSendMessage.mock.calls[0]?.[9]).toBeUndefined();
  });

  describe("draft row", () => {
    const succeeded = (value: unknown) => ({
      status: Office.AsyncResultStatus.Succeeded,
      value,
    });
    const composeItem = (extra: Record<string, unknown> = {}) => {
      (Office.context.mailbox as unknown as { item: unknown }).item = {
        subject: {},
        body: {
          getTypeAsync: (callback: (result: unknown) => void) =>
            callback(succeeded(Office.CoercionType.Text)),
        },
        ...extra,
      };
    };
    const composeMessage = (bodyText: string) => {
      h.mailItem = {
        itemKind: "message",
        isComposeMode: true,
        bodyText,
        bodyHtml: null,
        subject: "",
      };
      composeItem();
    };
    const draftRow = () => screen.getByTestId("outlook-draft-chip");
    const facetOf = (
      onSendMessage: ReturnType<typeof vi.fn>,
      call: number,
    ): { id: string; args?: Record<string, unknown> } | undefined =>
      onSendMessage.mock.calls[call]?.[4] as
        | { id: string; args?: Record<string, unknown> }
        | undefined;

    beforeEach(() => {
      unstageDrops();
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
      ]);
    });

    it("reads unchanged after the send carried the draft, as the next send does", async () => {
      composeMessage("Dear Bob");
      const { onSendMessage, rerender, ui } = renderInput({
        chatId: "chat-1",
      });
      expect(draftRow()).toHaveAttribute("data-state", "included");
      expect(draftRow()).toHaveTextContent("Your draft is included as context");
      expect(
        within(draftRow()).getByText("📝", { exact: false }),
      ).toHaveAttribute("aria-hidden", "true");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "superseded"),
      );
      expect(draftRow()).toHaveTextContent(
        "Your draft is unchanged, not re-sent",
      );
      // Muted text needs the primary fill to keep 4.5:1.
      expect(draftRow()).toHaveClass(
        "text-theme-fg-muted",
        "bg-theme-bg-primary",
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)).toBeUndefined();

      composeMessage("Dear Bob, v2");
      rerender(ui());
      expect(draftRow()).toHaveAttribute("data-state", "included");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(3));
      expect(facetOf(onSendMessage, 2)?.args?.full_body).toBe("Dear Bob, v2");
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "superseded"),
      );

      rerender(ui({ chatId: "chat-2" }));
      expect(draftRow()).toHaveAttribute("data-state", "included");
    });

    it("rolls the row back to included when the send is declined", async () => {
      stageDrop();
      composeMessage("Dear Bob");
      h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
      const { onSendMessage } = renderInput({ chatId: "chat-1" });

      send();

      await expectDeclinedSend(onSendMessage);
      expect(draftRow()).toHaveAttribute("data-state", "included");
    });

    it("says the draft is not sent while scheduling, as the send does", async () => {
      composeMessage("Dear Bob");
      h.calendarFetcher = {};
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
        ["outlook_schedule", new Set<string>()],
      ]);
      const { onSendMessage } = renderInput({
        lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
      });

      expect(draftRow()).toHaveAttribute("data-state", "superseded");
      expect(draftRow()).toHaveTextContent(
        "Your draft is not sent while scheduling",
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_schedule");
    });

    it("returns to included when the scheduling window closes", () => {
      vi.useFakeTimers();
      try {
        composeMessage("Dear Bob");
        h.calendarFetcher = {};
        h.availableFacetArgs = new Map([
          ["outlook_review_draft", new Set<string>()],
          ["outlook_schedule", new Set<string>()],
        ]);
        renderInput({
          lastSchedulingSignalAt: new Date(
            Date.now() - SCHEDULING_THREAD_MAX_AGE_MS + 1_000,
          ).toISOString(),
        });
        expect(draftRow()).toHaveAttribute("data-state", "superseded");

        act(() => {
          vi.advanceTimersByTime(1_001);
        });

        expect(draftRow()).toHaveAttribute("data-state", "included");
        expect(draftRow()).toHaveTextContent(
          "Your draft is included as context",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("reads appointment details unchanged although the live form differs from the bound item", async () => {
      const bindTime = {
        subject: "Planning",
        organizer: null,
        requiredAttendees: [
          { displayName: "Bob", emailAddress: "bob@example.com" },
        ],
        optionalAttendees: [],
        location: "",
        start: new Date("2026-08-10T08:00:00.000Z"),
        end: new Date("2026-08-10T09:00:00.000Z"),
        bodyText: "Agenda",
        bodyHtml: null,
      };
      h.mailItem = {
        ...bindTime,
        itemKind: "appointment",
        isComposeMode: true,
      };
      composeItem({ itemType: "appointment" });
      h.availableFacetArgs = new Map([
        ["outlook_review_appointment", new Set<string>()],
      ]);
      h.readAppointmentComposeSnapshot.mockResolvedValue({
        ...bindTime,
        location: "Room 3",
      });
      const { onSendMessage } = renderInput({ chatId: "chat-1" });
      expect(draftRow()).toHaveTextContent(
        "Appointment details are included as context",
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_appointment");
      expect(facetOf(onSendMessage, 0)?.args?.location).toBe("Room 3");
      await waitFor(() =>
        expect(draftRow()).toHaveTextContent(
          "Appointment details unchanged, not re-sent",
        ),
      );
      expect(draftRow()).toHaveAttribute("data-state", "superseded");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)).toBeUndefined();
    });
  });

  describe("draft row after edits the host reports", () => {
    const eventTypes = Office.EventType as unknown as Record<
      string,
      string | undefined
    >;
    const handlers = new Map<string, () => void>();
    const succeeded = (value: unknown) => ({
      status: Office.AsyncResultStatus.Succeeded,
      value,
    });
    const liveItem = (extra: Record<string, unknown>) => {
      (Office.context.mailbox as unknown as { item: unknown }).item = {
        subject: {},
        body: {
          getTypeAsync: (callback: (result: unknown) => void) =>
            callback(succeeded(Office.CoercionType.Text)),
        },
        addHandlerAsync: (eventType: string, handler: () => void) => {
          handlers.set(eventType, handler);
        },
        removeHandlerAsync: (eventType: string) => {
          handlers.delete(eventType);
        },
        ...extra,
      };
    };
    const draftRow = () => screen.getByTestId("outlook-draft-chip");
    const facetOf = (onSendMessage: ReturnType<typeof vi.fn>, call: number) =>
      onSendMessage.mock.calls[call]?.[4] as
        | { id: string; args?: Record<string, unknown> }
        | undefined;

    beforeEach(() => {
      unstageDrops();
      handlers.clear();
      eventTypes.RecipientsChanged = "olkRecipientsChanged";
      eventTypes.AppointmentTimeChanged = "olkAppointmentTimeChanged";
    });
    afterEach(() => {
      delete eventTypes.RecipientsChanged;
      delete eventTypes.AppointmentTimeChanged;
    });

    it("re-includes the draft after a recipient edit, as the next send does", async () => {
      let to = [{ displayName: "Mark", emailAddress: "mark@example.com" }];
      h.mailItem = {
        itemKind: "message",
        isComposeMode: true,
        bodyText: "Dear Bob",
        bodyHtml: null,
        subject: "",
      };
      liveItem({
        to: {
          getAsync: (callback: (result: unknown) => void) =>
            callback(succeeded(to)),
        },
      });
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set(["recipients"])],
      ]);
      const { onSendMessage } = renderInput({ chatId: "chat-1" });

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "superseded"),
      );

      to = [...to, { displayName: "Ana", emailAddress: "ana@example.com" }];
      act(() => handlers.get("olkRecipientsChanged")?.());
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "included"),
      );
      expect(draftRow()).toHaveTextContent("Your draft is included as context");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)?.id).toBe("outlook_review_draft");
      expect(facetOf(onSendMessage, 1)?.args?.recipients).toBe(
        JSON.stringify({ to }),
      );
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "superseded"),
      );
    });

    it("re-includes appointment details after a time edit, as the next send does", async () => {
      const bindTime = {
        subject: "Planning",
        organizer: null,
        requiredAttendees: [],
        optionalAttendees: [],
        location: "",
        start: new Date("2026-08-10T08:00:00.000Z"),
        end: new Date("2026-08-10T09:00:00.000Z"),
        bodyText: "Agenda",
        bodyHtml: null,
      };
      h.mailItem = {
        ...bindTime,
        itemKind: "appointment",
        isComposeMode: true,
      };
      liveItem({ itemType: "appointment" });
      h.availableFacetArgs = new Map([
        ["outlook_review_appointment", new Set<string>()],
      ]);
      h.readAppointmentComposeSnapshot.mockResolvedValue(bindTime);
      const { onSendMessage } = renderInput({ chatId: "chat-1" });

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(draftRow()).toHaveTextContent(
          "Appointment details unchanged, not re-sent",
        ),
      );

      const moved = {
        ...bindTime,
        start: new Date("2026-08-11T08:00:00.000Z"),
        end: new Date("2026-08-11T09:00:00.000Z"),
      };
      h.readAppointmentComposeSnapshot.mockResolvedValue(moved);
      act(() => handlers.get("olkAppointmentTimeChanged")?.());
      await waitFor(() =>
        expect(draftRow()).toHaveAttribute("data-state", "included"),
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)?.id).toBe("outlook_review_appointment");
      await waitFor(() =>
        expect(draftRow()).toHaveTextContent(
          "Appointment details unchanged, not re-sent",
        ),
      );
    });
  });

  describe("selection chip", () => {
    const longSelection = `${"a".repeat(79)}😀 and the rest of it`;

    beforeEach(() => {
      unstageDrops();
      h.mailItem = {
        itemKind: "message",
        isComposeMode: true,
        bodyText: "Dear Bob",
        bodyHtml: null,
        subject: "",
      };
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
      ]);
      h.composeSelection = { data: longSelection, sourceProperty: "body" };
    });

    it("uses the shared chip and cuts at a code point", () => {
      renderInput();

      const chip = screen.getByTestId("outlook-selection-chip");
      expect(chip.querySelector('[aria-hidden="true"]')).toHaveTextContent(
        "✂",
      );
      expect(chip).toHaveTextContent(`${"a".repeat(79)}😀...`);
      // A selection replaces the draft, so the draft row stays away.
      expect(screen.queryByTestId("outlook-draft-chip")).toBeNull();
    });

    it("stays dismissed until the selection or the item changes", () => {
      const { rerender, ui } = renderInput();

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss selection" }),
      );
      expect(screen.queryByTestId("outlook-selection-chip")).toBeNull();
      expect(screen.getByTestId("outlook-draft-chip")).toBeVisible();

      h.composeSelection = { data: "", sourceProperty: "body" };
      rerender(ui());
      h.composeSelection = { data: longSelection, sourceProperty: "body" };
      rerender(ui());
      expect(screen.getByTestId("outlook-selection-chip")).toBeVisible();

      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss selection" }),
      );
      h.itemIdentity = "item-2";
      rerender(ui());
      expect(screen.getByTestId("outlook-selection-chip")).toBeVisible();
    });
  });

  describe("email cards", () => {
    it("no longer renders an email-body item in the compose fallback", () => {
      unstageDrops();
      Object.assign(h.emailSource, {
        emailBodyFile: emlFile,
        isEmailBodyIncluded: true,
        selectedAttachmentItems: [{ id: "att-1", filename: "plan.pdf" }],
      });

      renderInput({ showSuggestedEmailSource: true });

      const fallback = h.groups.find(
        (group) => group.id === "current-email-fallback",
      );
      expect(fallback?.items.map((item) => item.id)).toEqual(["att-1"]);
    });

    it("pins a dropped email's Remove to its header and names the email", () => {
      const { onEmailSourceDropsSent } = renderInput();

      expect(
        screen.getByTestId(`group-staged-email:${DROP_KEY}`),
      ).toHaveAttribute("data-pin-actions", "true");
      fireEvent.click(screen.getByRole("button", { name: "Remove Quarterly" }));
      expect(onEmailSourceDropsSent).toHaveBeenCalledWith([
        { key: DROP_KEY, messageId: "<quarterly@x>" },
      ]);
    });

    it("hands focus to the composer when a keyboard Remove takes the card away", () => {
      const { onEmailSourceDropsSent } = renderInput();
      const remove = screen.getByRole("button", { name: "Remove Quarterly" });
      remove.focus();
      expect(remove).toHaveFocus();

      fireEvent.keyDown(remove, { key: "Enter" });
      fireEvent.click(remove);

      expect(onEmailSourceDropsSent).toHaveBeenCalledTimes(1);
      expect(h.controls.focusInput).toHaveBeenCalledTimes(1);
      expect(h.controls.focusInput.mock.invocationCallOrder[0]).toBeGreaterThan(
        onEmailSourceDropsSent.mock.invocationCallOrder[0],
      );
    });

    describe("thread under an unticked message", () => {
      const attachment = (
        id: string,
        filename: string,
        extra: Record<string, unknown> = {},
      ) => ({
        id,
        filename,
        mimeType: "application/octet-stream",
        size: 10,
        contentBytes: null,
        isInline: false,
        contentId: null,
        unavailableReason: null,
        ...extra,
      });
      const message = (id: string, attachments: unknown[]) => ({
        id,
        internetMessageId: id,
        subject: "Kickoff",
        from: { name: "Anna", address: "anna@example.com" },
        to: [],
        cc: [],
        date: null,
        bodyText: "hi",
        bodyHtml: null,
        attachments,
      });
      const threadKey = "current-thread:conv-1";
      const stageThread = () => {
        unstageDrops();
        h.capabilities = [
          {
            id: "pdf",
            extensions: ["pdf"],
            mime_types: ["application/pdf"],
            operations: ["extract_text"],
          },
          { id: "exe", extensions: ["exe"], mime_types: [], operations: [] },
        ];
        h.emailSource.stagedEmails = [
          {
            key: threadKey,
            source: "current-thread",
            thread: {
              conversationId: "conv-1",
              subject: "Kickoff",
              incomplete: false,
              messages: [
                message("m1", [
                  attachment("a1", "plan.pdf"),
                  attachment("a2", "notes.pdf"),
                  attachment("a3", "setup.exe"),
                  attachment("a4", "logo.png", { isInline: true }),
                  attachment("a5", "budget.pdf"),
                ]),
                message("m2", []),
              ],
            },
            dismissedMessageIds: new Set(["m1"]),
            dismissedAttachmentIds: new Set(["a2"]),
          },
        ];
      };
      const threadAttachments = () => {
        const group = h.groups.find(
          (candidate) => candidate.id === `staged-email:${threadKey}`,
        );
        const first = group?.items[0];
        if (first?.kind !== "threadMessageGroup") {
          throw new Error("expected a thread message");
        }
        return { group, message: first, attachments: first.attachments };
      };

      it("reads every attachment unticked and counts the messages", () => {
        stageThread();
        renderInput({ showSuggestedEmailSource: true });

        const { group, message: card, attachments } = threadAttachments();
        expect(group?.metaLabel).toMatch(/^2 messages · /);
        expect(card.selected).toBe(false);
        expect(attachments.map((entry) => entry.id)).toEqual([
          "a1",
          "a2",
          "a3",
          "a5",
        ]);
        expect(attachments.every((entry) => entry.selected === false)).toBe(
          true,
        );
        // Policy-excluded parts stay read-only.
        expect(attachments[2]?.onToggle).toBeUndefined();
      });

      it("brings the message back with only the ticked attachment", () => {
        stageThread();
        renderInput({ showSuggestedEmailSource: true });

        act(() => threadAttachments().attachments[0]?.onToggle?.());

        expect(h.emailSource.restoreStagedEmailBody).toHaveBeenCalledWith("m1");
        expect(
          h.emailSource.restoreStagedEmailAttachment,
        ).not.toHaveBeenCalled();
        expect(
          (
            h.emailSource.dismissStagedEmailAttachment as ReturnType<
              typeof vi.fn
            >
          ).mock.calls,
        ).toEqual([["m1", "a5"]]);
      });

      it("restores a dismissed attachment it ticks and holds back the rest", () => {
        stageThread();
        renderInput({ showSuggestedEmailSource: true });

        act(() => threadAttachments().attachments[1]?.onToggle?.());

        expect(h.emailSource.restoreStagedEmailBody).toHaveBeenCalledWith("m1");
        expect(h.emailSource.restoreStagedEmailAttachment).toHaveBeenCalledWith(
          "m1",
          "a2",
        );
        expect(
          (
            h.emailSource.dismissStagedEmailAttachment as ReturnType<
              typeof vi.fn
            >
          ).mock.calls,
        ).toEqual([
          ["m1", "a1"],
          ["m1", "a5"],
        ]);
      });
    });
  });
});
