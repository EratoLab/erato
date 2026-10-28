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
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { outlookContextStore } from "../../hooks/outlookContextStore";
import { LIVE_BODY_READ_TIMEOUT_MS } from "../../hooks/useLiveComposeFields";
import { SCHEDULING_THREAD_MAX_AGE_MS } from "../../utils/outlookScheduleTool";
import { EmailTrimError } from "../../utils/trimRawEmlBytes";
import { AddinChatInput } from "../AddinChatInput";
import { DRAFT_DETAIL_REFRESH_MS } from "../OutlookContextDetails";

import type {
  OutlookItemAttachment,
  OutlookSendFilesRequest,
  ResolvedDrop,
  StagedEmail,
} from "../../providers/OutlookEmailSourceProvider";
import type * as OutlookSendFiles from "../../utils/outlookSendFiles";
import type { ParsedEmail } from "../../utils/parsedEmail";
import type {
  ComposerContextItem,
  ComposerMode,
  FileAttachmentGroup,
} from "@erato/frontend/library";
import type { ComponentProps } from "react";

// The composer is a double that draws what the wrapper hands it: the lane's
// items (as the lane's control rule would), the modes, and a send button.
// Every hook the wrapper consults is mocked so a send can be driven end to
// end without Office, Graph, or a provider tree; the email source is a small
// store, so a provider write re-renders the wrapper as the real one would.
const h = vi.hoisted(() => {
  function groupsById(): Record<string, FileAttachmentGroup> {
    return {};
  }
  const uploadedFile = { id: "f1", filename: "notes.txt" };
  const checklistVisibleItems: Record<string, number | undefined> = {};
  const chatInput: { props: Record<string, unknown> } = { props: {} };
  const source: {
    state: Record<string, unknown>;
    listeners: Set<() => void>;
  } = { state: {}, listeners: new Set() };
  return {
    uploadedFile,
    mailItem: null as Record<string, unknown> | null,
    itemIdentity: "item-1",
    composeSelection: { data: "", sourceProperty: "body" },
    calendarFetcher: null as object | null,
    readAppointmentComposeSnapshot: vi.fn(),
    detailGroups: groupsById(),
    checklistVisibleItems,
    capabilities: [] as unknown[],
    availableFacetArgs: new Map<string, Set<string>>(),
    controls: {
      setDraftMessage: vi.fn(),
      focusInput: vi.fn(),
      setSelectedFacetIds: vi.fn(),
      setSelectedChatProviderId: vi.fn(),
      toggleFacetId: vi.fn(),
      addUploadedFiles: vi.fn(),
      removeUploadedFiles: vi.fn(),
      clearQueuedMessage: vi.fn(),
    },
    fileUploadState: { uploadedFiles: [uploadedFile], error: null },
    fetchUploadFile: vi.fn(),
    chatInput,
    source,
    maxSizeBytes: 1000,
    lastPlan: null as { parts: { name: string; size: number }[] } | null,
  };
});

// Pass-through, so a test can hold the composer's upload estimates against
// the parts the send plans to upload.
vi.mock("../../utils/outlookSendFiles", async (importOriginal) => {
  const actual = await importOriginal<typeof OutlookSendFiles>();
  return {
    ...actual,
    planOutlookFiles: (...args: Parameters<typeof actual.planOutlookFiles>) => {
      const plan = actual.planOutlookFiles(...args);
      h.lastPlan = plan;
      return plan;
    },
  };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  const { AlertMock, ContextLaneDouble } = await import(
    "../../../test/helpers/contextLaneDouble"
  );
  const { useOutlookComposerMenu } = await import(
    "../OutlookComposerMenuContext"
  );
  // What the registered "+" menu content reads from the composer.
  const MenuProbe = () => {
    const menu = useOutlookComposerMenu();
    return (
      <div
        data-testid="menu-state"
        data-thread={menu?.thread.row ?? ""}
        data-attachments={menu?.attachments ?? ""}
      />
    );
  };
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
  return mock.createEratoLibraryMock({
    Alert: AlertMock,
    ChatInput: (props: Record<string, unknown>) => {
      h.chatInput.props = props;
      const uploadError = props.uploadError;
      const sizeLimitExceeded = props.sizeLimitExceeded;
      const modes = props.composerModes as ComposerMode[] | undefined;
      return (
        <div
          data-testid="chat-input"
          data-disabled={props.disabled ? "true" : "false"}
          data-upload-error={
            uploadError instanceof Error ? uploadError.message : ""
          }
          data-size-limit={
            sizeLimitExceeded ? JSON.stringify(sizeLimitExceeded) : ""
          }
        >
          <ContextLaneDouble
            items={props.contextItems as ComposerContextItem[]}
          />
          <MenuProbe />
          <div data-testid="composer-modes">
            {modes?.map((mode) => (
              <button
                key={mode.id}
                type="button"
                data-mode-id={mode.id}
                disabled={mode.locked}
                title={mode.locked ? mode.lockReason : mode.description}
                onClick={mode.onEnd}
              >
                {mode.endLabel}
              </button>
            ))}
          </div>
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
    // Every row a detail draws, with its toggle as a button.
    GroupedFileAttachmentsPreview: ({
      groups,
      defaultVisibleItems,
    }: {
      groups: FileAttachmentGroup[];
      defaultVisibleItems?: number;
    }) => {
      for (const group of groups) {
        h.detailGroups[group.id] = group;
        h.checklistVisibleItems[group.id] = defaultVisibleItems;
      }
      return (
        <div>
          {groups.flatMap((group) =>
            group.items.flatMap((item) => {
              if (item.kind === "threadMessageGroup") {
                return [
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`row-${item.id}`}
                    data-selected={String(item.selected)}
                    disabled={!item.onToggle}
                    onClick={item.onToggle}
                  >
                    {item.label}
                  </button>,
                  ...item.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      data-testid={`row-${attachment.id}`}
                      data-selected={String(attachment.selected)}
                      disabled={!attachment.onToggle}
                      onClick={attachment.onToggle}
                    >
                      {(attachment.file as { filename: string }).filename}
                    </button>
                  )),
                ];
              }
              if (item.kind === "selectableAttachment") {
                return [
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`row-${item.id}`}
                    data-selected={String(item.selected)}
                    data-meta={item.metaLabel}
                    disabled={!item.onToggle}
                    onClick={item.onToggle}
                  >
                    {(item.file as { displayName?: string; filename: string })
                      .displayName ??
                      (item.file as { filename: string }).filename}
                  </button>,
                ];
              }
              return [];
            }),
          )}
        </div>
      );
    },
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
  });
});

vi.mock("../../../providers/OfficeProvider", () => ({
  useOffice: () => ({ host: "Outlook", mailboxUser: null }),
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
vi.mock("../../providers/OutlookEmailSourceProvider", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    h.source.listeners.add(listener);
    return () => {
      h.source.listeners.delete(listener);
    };
  };
  return {
    useOutlookEmailSource: () =>
      useSyncExternalStore(subscribe, () => h.source.state),
  };
});

function source() {
  return h.source.state as Record<string, ReturnType<typeof vi.fn>> &
    Record<string, unknown>;
}

/** A provider write, as the provider's own handlers make it. */
function writeSource(patch: Record<string, unknown>) {
  h.source.state = { ...h.source.state, ...patch };
  for (const listener of h.source.listeners) listener();
}

/** A change from outside the tree, flushed before the next interaction. */
function setSource(patch: Record<string, unknown>) {
  act(() => writeSource(patch));
}

const attachmentFiles = new Map<string, File>();

/** The provider's send, as its contract reads: exactly what the plan says. */
async function resolveAsPlanned(plan: OutlookSendFilesRequest) {
  const state = h.source.state as {
    threadFile: File | null;
    resolvedDrops: ResolvedDrop[];
    itemAttachments: OutlookItemAttachment[];
  };
  if (plan.thread.kind === "error" && plan.thread.why === "trim") {
    throw new EmailTrimError("thread.eml");
  }
  const failed = state.resolvedDrops.find((drop) => drop.error);
  if (failed?.error) throw failed.error;
  const files: File[] = [];
  if (plan.uploadThread && state.threadFile) files.push(state.threadFile);
  for (const drop of state.resolvedDrops) if (drop.file) files.push(drop.file);
  const sentAttachmentIds: string[] = [];
  for (const id of plan.composeAttachmentIds) {
    const attachment = state.itemAttachments.find((entry) => entry.id === id);
    if (!attachment || attachment.cloud) continue;
    files.push(attachmentFiles.get(id) ?? new File([id], attachment.name));
    sentAttachmentIds.push(id);
  }
  return { files, sentAttachmentIds };
}

const emlBytes = new TextEncoder().encode(
  "Subject: Quarterly\r\n\r\nhi",
).buffer;
const emlFile = new File([emlBytes], "quarterly.eml", {
  type: "message/rfc822",
});
const threadFile = new File(["thread bytes"], "conversation.eml", {
  type: "message/rfc822",
});

function droppedEmail(over: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    rawBytes: emlBytes,
    rawEmlFile: emlFile,
    messageId: "<quarterly@x>",
    subject: "Quarterly",
    from: { name: "Lena Hoffmann", address: "lena@example.com" },
    to: [],
    cc: [],
    bcc: [],
    date: null,
    text: "hi",
    html: null,
    attachments: [],
    ...over,
  };
}

const DROP_KEY = "drop-1";

function stagedDrop(parsed = droppedEmail()): StagedEmail {
  return {
    key: DROP_KEY,
    source: "drop",
    parsed,
    bodyDismissed: false,
    dismissedAttachmentIds: new Set(),
  };
}

function stageDrop(size = emlFile.size, parsed = droppedEmail()) {
  const others = (
    (h.source.state.stagedEmails as StagedEmail[] | undefined) ?? []
  ).filter((staged) => staged.source !== "drop");
  setSource({
    stagedEmails: [...others, stagedDrop(parsed)],
    resolvedDrops: [{ key: DROP_KEY, file: emlFile, size }],
    resolvedParts: [{ key: DROP_KEY, name: emlFile.name, size }],
  });
}

function unstageDrops() {
  const others = (
    (h.source.state.stagedEmails as StagedEmail[] | undefined) ?? []
  ).filter((staged) => staged.source !== "drop");
  setSource({ stagedEmails: others, resolvedDrops: [], resolvedParts: [] });
}

const threadMessage = (id: string, attachments: unknown[] = []) => ({
  id,
  internetMessageId: id,
  subject: "RE: Q4 vendor contract renewal",
  from: { name: "Anna Weber", address: "anna@example.com" },
  to: [],
  cc: [],
  date: null,
  bodyText: "hi",
  bodyHtml: null,
  attachments,
});

const THREAD_KEY = "current-thread:conv-1";

function stageThread({
  dismissed = [],
  file = threadFile,
}: { dismissed?: string[]; file?: File | null } = {}) {
  const thread = {
    conversationId: "conv-1",
    subject: "RE: Q4 vendor contract renewal",
    incomplete: false,
    messages: ["m1", "m2", "m3", "m4", "m5"].map((id) =>
      threadMessage(
        id,
        id === "m1"
          ? [
              {
                id: "m1:a1",
                filename: "contract-v3.pdf",
                mimeType: "application/pdf",
                size: 10,
                contentBytes: null,
                isInline: false,
                contentId: null,
                unavailableReason: null,
              },
            ]
          : [],
      ),
    ),
  };
  const drops = (
    (h.source.state.stagedEmails as StagedEmail[] | undefined) ?? []
  ).filter((staged) => staged.source === "drop");
  setSource({
    threadStatus: "ready",
    currentThread: thread,
    threadFile: file,
    stagedEmails: [
      {
        key: THREAD_KEY,
        source: "current-thread",
        thread,
        dismissedMessageIds: new Set(dismissed),
        dismissedAttachmentIds: new Set(),
      },
      ...drops,
    ],
  });
}

function readItem() {
  h.mailItem = {
    itemKind: "message",
    isComposeMode: false,
    bodyText: null,
    bodyHtml: null,
    subject: "RE: Q4 vendor contract renewal",
    conversationId: "conv-1",
    internetMessageId: "<open@x>",
  };
}

const succeeded = (value: unknown) => ({
  status: Office.AsyncResultStatus.Succeeded,
  value,
});

function liveCompose(extra: Record<string, unknown> = {}) {
  (Office.context.mailbox as unknown as { item: unknown }).item = {
    subject: {},
    body: {
      getTypeAsync: (callback: (result: unknown) => void) =>
        callback(succeeded(Office.CoercionType.Text)),
    },
    ...extra,
  };
}

function composeMessage(bodyText: string) {
  h.mailItem = {
    itemKind: "message",
    isComposeMode: true,
    bodyText,
    bodyHtml: null,
    subject: "",
    to: [],
    cc: [],
  };
  liveCompose();
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

function items() {
  return h.chatInput.props.contextItems as ComposerContextItem[];
}

/** jsdom's File has no text(). */
function readText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function item(id: string) {
  return items().find((entry) => entry.id === id);
}

function chip(id: string) {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="context-lane"] [data-id="${id}"]`,
  );
  if (!found) throw new Error(`no chip ${id}`);
  return found;
}

function queryChip(id: string) {
  return document.querySelector<HTMLElement>(
    `[data-testid="context-lane"] [data-id="${id}"]`,
  );
}

function meta(id: string) {
  return within(chip(id)).queryByTestId("context-chip-meta")?.textContent;
}

function press(id: string, name: string) {
  fireEvent.click(within(chip(id)).getByRole("button", { name }));
}

function detailAction(id: string, actionId: string) {
  const button = chip(id).querySelector<HTMLButtonElement>(
    `[data-action-id="${actionId}"]`,
  );
  if (!button) throw new Error(`no action ${actionId} on ${id}`);
  fireEvent.click(button);
}

function modeButton(name: string) {
  return within(screen.getByTestId("composer-modes")).getByRole("button", {
    name,
  });
}

function endScheduling() {
  fireEvent.click(modeButton("End scheduling"));
}

function composerDisabled() {
  return screen.getByTestId("chat-input").getAttribute("data-disabled");
}

function menuState() {
  const probe = screen.getByTestId("menu-state");
  return {
    thread: probe.getAttribute("data-thread"),
    attachments: probe.getAttribute("data-attachments"),
  };
}

/** Whatever the store recorded as sent, across conversations. */
function recordedSends() {
  return [...outlookContextStore.getSnapshot().values()].flatMap((entry) => [
    ...entry.thread.sentInChat,
    ...entry.attachments.sentIds,
  ]);
}

function uploadedNames() {
  return h.fetchUploadFile.mock.calls.map(
    ([request]) =>
      ((request as { body: FormData }).body.get("file") as File).name,
  );
}

function facetOf(onSendMessage: ReturnType<typeof vi.fn>, call: number) {
  return onSendMessage.mock.calls[call]?.[4] as
    | { id: string; args?: Record<string, unknown> }
    | undefined;
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
    h.detailGroups = {};
    h.checklistVisibleItems = {};
    h.capabilities = [];
    h.availableFacetArgs = new Map();
    attachmentFiles.clear();
    i18n.activate("en");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.fetchUploadFile.mockReset();
    h.fetchUploadFile.mockResolvedValue({ files: [{ id: "u1" }] });
    (
      Office as unknown as { context: Record<string, unknown> }
    ).context.mailbox = { item: null };
    h.source.state = {
      emailSubject: "",
      stagedEmails: [],
      currentThread: null,
      threadFile: null,
      threadStatus: "none",
      threadTrimError: null,
      emailThreadSignIn: null,
      signingIn: false,
      retryEmailThread: vi.fn(),
      signInForEmail: vi.fn(async () => {}),
      restoreEmailBody: vi.fn(),
      itemAttachments: [],
      dismissedAttachmentIds: [],
      isLoadingAttachments: false,
      removeAttachment: vi.fn((id: string) =>
        writeSource({
          dismissedAttachmentIds: [
            ...(h.source.state.dismissedAttachmentIds as string[]),
            id,
          ],
        }),
      ),
      restoreAttachment: vi.fn((id: string) =>
        writeSource({
          dismissedAttachmentIds: (
            h.source.state.dismissedAttachmentIds as string[]
          ).filter((entry) => entry !== id),
        }),
      ),
      resolveSelectedFilesForSend: vi.fn(resolveAsPlanned),
      getFileProvenance: vi.fn(() => undefined),
      parentReplyContext: null,
      dismissStagedEmailAttachment: vi.fn(),
      restoreStagedEmailAttachment: vi.fn(),
      dismissStagedEmailBody: vi.fn(),
      restoreStagedEmailBody: vi.fn(),
      setPolicyExcludedAttachmentIds: vi.fn(),
      isThreadEmlStale: false,
      isDropResolutionStale: false,
      resolvedDrops: [],
      resolvedParts: [],
    };
  });

  afterEach(() => {
    cleanup();
    outlookContextStore.resetForTests();
    h.source.listeners.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("sending", () => {
    beforeEach(() => stageDrop());

    it("reads live compose recipients and sends them with the compose facet", async () => {
      unstageDrops();
      h.mailItem = {
        itemKind: "message",
        isComposeMode: true,
        bodyText: "",
        subject: "",
      };
      h.availableFacetArgs = new Map([
        ["compose_email", new Set(["recipients"])],
      ]);
      const recipient = {
        displayName: "Mark",
        emailAddress: "mark@example.com",
      };
      const getAsync = vi.fn((callback) => callback(succeeded([recipient])));
      liveCompose({ to: { getAsync } });
      const { onSendMessage } = renderInput();
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(getAsync).toHaveBeenCalledTimes(1);
      expect(facetOf(onSendMessage, 0)).toEqual({
        id: "compose_email",
        args: {
          body_format: "text",
          recipients: JSON.stringify({ to: [recipient] }),
        },
      });
    });

    it("sends the uploaded email ids with the message and releases the drop", async () => {
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
      readItem();
      stageThread();
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
      source().getFileProvenance.mockImplementation((file: File) =>
        file === threadFile ? provenance : undefined,
      );
      h.fetchUploadFile
        .mockResolvedValueOnce({ files: [{ id: "thread-upload" }] })
        .mockResolvedValueOnce({ files: [{ id: "drop-upload" }] });
      const { onSendMessage } = renderInput({ freshChat: true });
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
      expect((error as UploadTooLargeError).filenames).toEqual([
        "quarterly.eml",
      ]);
    });

    it("refuses the send when the dismissed attachments cannot be left out", async () => {
      setSource({
        resolvedDrops: [
          {
            key: DROP_KEY,
            file: null,
            size: 0,
            error: new EmailTrimError("quarterly.eml"),
          },
        ],
      });
      const { onSendMessage } = renderInput();
      expect(chip(`outlook-drop:${DROP_KEY}`)).toHaveAttribute(
        "data-state",
        "error",
      );

      send();

      await expectDeclinedSend(onSendMessage);
      expect(h.fetchUploadFile).not.toHaveBeenCalled();
      expect(uploadErrorText()).toContain(
        "Couldn't leave out the unchecked attachments of quarterly.eml.",
      );
    });

    it("leaves the size check to the composer, through the drop's upload estimate", () => {
      unstageDrops();
      stageDrop(h.maxSizeBytes + 1);
      const oversized = new File(
        ["x".repeat(h.maxSizeBytes + 1)],
        "quarterly.eml",
      );
      setSource({
        resolvedDrops: [
          { key: DROP_KEY, file: oversized, size: h.maxSizeBytes + 1 },
        ],
      });

      renderInput();

      expect(h.chatInput.props.sizeLimitExceeded).toBeNull();
      expect(item(`outlook-drop:${DROP_KEY}`)).toMatchObject({
        state: "included",
        estimate: oversized,
        estimateUpload: true,
      });
    });

    it("passes the owner's own verdict through", () => {
      const verdict = { names: [], formatted: "3", kind: "count" as const };
      renderInput({ sizeLimitExceeded: verdict });
      expect(h.chatInput.props.sizeLimitExceeded).toBe(verdict);
    });

    describe("the uploads the composer counts are the parts the send uploads", () => {
      const uploads = () =>
        items()
          .filter(
            (entry) =>
              entry.state === "included" &&
              entry.estimateUpload &&
              entry.estimate,
          )
          .map((entry) => ({
            name: entry.estimate!.name,
            size: entry.estimate!.size,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      const parts = () =>
        (h.lastPlan?.parts ?? [])
          .map(({ name, size }) => ({ name, size }))
          .sort((a, b) => a.name.localeCompare(b.name));

      it("for a fresh thread and two drops", () => {
        readItem();
        stageThread();
        const second = new File(["second drop"], "second.eml");
        setSource({
          stagedEmails: [
            ...(h.source.state.stagedEmails as StagedEmail[]),
            { ...stagedDrop(), key: "drop-2" },
          ],
          resolvedDrops: [
            { key: DROP_KEY, file: emlFile, size: emlFile.size },
            { key: "drop-2", file: second, size: second.size },
          ],
        });
        renderInput({ freshChat: true });

        expect(parts()).toHaveLength(3);
        expect(uploads()).toEqual(parts());
      });

      it("for a drop whose attachments could not be left out: neither counts it", () => {
        setSource({
          resolvedDrops: [
            {
              key: DROP_KEY,
              file: null,
              size: 0,
              error: new EmailTrimError("quarterly.eml"),
            },
          ],
        });
        renderInput();

        expect(parts()).toEqual([]);
        expect(uploads()).toEqual([]);
      });

      it("for a drop being re-read after a tick: both count its last file", () => {
        setSource({ isDropResolutionStale: true });
        renderInput();

        expect(item(`outlook-drop:${DROP_KEY}`)?.state).toBe("included");
        expect(parts()).toHaveLength(1);
        expect(uploads()).toEqual(parts());
      });
    });

    it("clears the failure once the drop it named is gone", async () => {
      h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
      const { onSendMessage } = renderInput();
      send();
      await expectDeclinedSend(onSendMessage);
      expect(uploadErrorText()).not.toBe("");

      act(() => unstageDrops());

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

      await waitFor(() =>
        expect(h.chatInput.props.uploadError).toBe(ownerError),
      );
    });

    it("names the paused Reply and Send on the write switch", () => {
      renderInput();

      // The action facet rides along implicitly from this composer, so the
      // Outlook build is the one host whose toggle must name the consequence.
      expect(h.chatInput.props.pausesHostActionsWhenWritesOff).toBe(true);
    });

    it.each([
      ["writes-off seed", 6, false, 8],
      ["switched-off servers", 7, ["linear"], 9],
      ["switched-off tools", 8, ["linear/create_issue"], 10],
    ] as const)(
      "carries a new chat's %s through to the host send",
      async (_name, slot, value, sentSlot) => {
        const { onSendMessage } = renderInput();
        const args: unknown[] = [
          "first",
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ];
        args[slot] = value;

        (h.chatInput.props.onSendMessage as (...a: unknown[]) => void)(...args);

        // After the action facet and the item identity the wrapper inserts.
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(onSendMessage.mock.calls[0]?.[sentSlot]).toEqual(value);
        expect(onSendMessage.mock.calls[0]?.[5]).toBe("item-1");
      },
    );
  });

  describe("the draft", () => {
    beforeEach(() => {
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
      ]);
    });

    it("names the reply it answers and leaves out the old rows", () => {
      composeMessage("Dear Anna");
      setSource({
        parentReplyContext: {
          subject: "Q4 vendor contract",
          fromName: "Anna Weber",
          fromAddress: "anna@example.com",
        },
      });
      renderInput({ chatId: "chat-1" });

      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
      expect(meta("outlook-draft")).toBe("Reply to Anna Weber");
      expect(
        within(chip("outlook-draft")).getByTestId("context-chip-label"),
      ).toHaveTextContent("Your draft");
      // Today's rows above the composer are gone; everything is a chip.
      for (const testId of [
        "outlook-draft-chip",
        "outlook-selection-chip",
        `addin-staged-email-remove-${DROP_KEY}`,
        "addin-chat-email-expansion-indicator",
      ]) {
        expect(screen.queryByTestId(testId)).toBeNull();
      }
      expect(
        screen.queryByRole("region", { name: "Email context preview" }),
      ).toBeNull();
      expect(screen.queryByText("📝")).toBeNull();
    });

    it("counts the draft it carries toward the token estimate", async () => {
      composeMessage("Dear Anna");
      renderInput({ chatId: "chat-1" });

      const draft = item("outlook-draft");
      expect(draft?.state).toBe("included");
      expect(draft?.estimateUpload).toBeUndefined();
      expect(await readText(draft!.estimate!)).toContain(
        "full_body: Dear Anna",
      );
    });

    it("carries no estimate once the draft would not go again", async () => {
      composeMessage("Dear Bob");
      const { onSendMessage } = renderInput({ chatId: "chat-1" });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(item("outlook-draft")?.state).toBe("superseded"),
      );
      expect(item("outlook-draft")?.estimate).toBeUndefined();
    });

    it("moves the estimate to the selection that replaces the draft", async () => {
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
        ["outlook_rewrite_selection", new Set<string>()],
      ]);
      h.composeSelection = {
        data: "Could you confirm",
        sourceProperty: "body",
      };
      composeMessage("Dear Anna, could you confirm?");
      renderInput({ chatId: "chat-1" });

      expect(item("outlook-draft")?.state).toBe("superseded");
      expect(item("outlook-draft")?.estimate).toBeUndefined();
      expect(await readText(item("outlook-selection")!.estimate!)).toContain(
        "selected_text: Could you confirm",
      );
    });

    it("leaves the draft out after (x), brings it back with (+), and resets on another item", async () => {
      composeMessage("Dear Bob");
      const { onSendMessage, rerender, ui } = renderInput({ chatId: "chat-1" });

      press("outlook-draft", "Don't include draft");
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "suggested");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)).toBeUndefined();

      press("outlook-draft", "Include draft");
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");

      press("outlook-draft", "Don't include draft");
      h.itemIdentity = "item-2";
      rerender(ui());
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
    });

    it("reads unchanged after the send carried it, and included again once declined", async () => {
      composeMessage("Dear Bob");
      const { onSendMessage, rerender, ui } = renderInput({ chatId: "chat-1" });

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
      await waitFor(() =>
        expect(chip("outlook-draft")).toHaveAttribute(
          "data-state",
          "superseded",
        ),
      );
      expect(meta("outlook-draft")).toBe("Unchanged, not re-sent");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)).toBeUndefined();

      composeMessage("Dear Bob, v2");
      rerender(ui());
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");

      stageDrop();
      h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
      send();
      await waitFor(() =>
        expect(h.controls.setDraftMessage).toHaveBeenCalledWith("hello", {
          focus: true,
        }),
      );
      expect(onSendMessage).toHaveBeenCalledTimes(2);
      // The marker forgets a draft it never sent.
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
    });

    describe("typed in the item, which no event reports", () => {
      const typed = { text: "", getAsync: vi.fn() };
      function typeInDraft(bindTime: string) {
        composeMessage(bindTime);
        typed.text = bindTime;
        typed.getAsync = vi.fn(
          (_coercion: unknown, callback: (result: unknown) => void) =>
            callback(succeeded(typed.text)),
        );
        liveCompose({
          body: {
            getTypeAsync: (callback: (result: unknown) => void) =>
              callback(succeeded(Office.CoercionType.Text)),
            getAsync: typed.getAsync,
          },
        });
      }
      const detailShows = (text: string) =>
        within(chip("outlook-draft")).getByText(text);

      it("sends the text typed just before Send, and the chip shows it after", async () => {
        typeInDraft("Dear Bob");
        const { onSendMessage } = renderInput({ chatId: "chat-1" });
        await waitFor(() => expect(typed.getAsync).toHaveBeenCalled());

        typed.text = "Dear Bob, see you Friday";
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)).toEqual({
          id: "outlook_review_draft",
          args: { full_body: "Dear Bob, see you Friday", body_format: "text" },
        });
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );
        expect(detailShows("Dear Bob, see you Friday")).toBeInTheDocument();
      });

      it("sends an edited draft again instead of calling it unchanged", async () => {
        typeInDraft("Dear Bob");
        const { onSendMessage } = renderInput({ chatId: "chat-1" });
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );

        typed.text = "Dear Bob, v2";
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
        expect(facetOf(onSendMessage, 1)?.args?.full_body).toBe("Dear Bob, v2");
        await waitFor(() => expect(detailShows("Dear Bob, v2")).toBeTruthy());
        expect(meta("outlook-draft")).toBe("Unchanged, not re-sent");

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(3));
        expect(facetOf(onSendMessage, 2)).toBeUndefined();
      });

      it("carries a draft typed into an empty compose, not a request to write one", async () => {
        h.availableFacetArgs = new Map([
          ["outlook_review_draft", new Set<string>()],
          ["compose_email", new Set<string>()],
        ]);
        typeInDraft("");
        const { onSendMessage } = renderInput({ chatId: "chat-1" });
        expect(queryChip("outlook-draft")).toBeNull();

        typed.text = "Hi Anna, a quick question";
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
        expect(facetOf(onSendMessage, 0)?.args?.full_body).toBe(
          "Hi Anna, a quick question",
        );
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );
      });

      it("re-reads when the pane gains focus, so the chip says it goes again", async () => {
        typeInDraft("Dear Bob");
        const { onSendMessage } = renderInput({ chatId: "chat-1" });
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );

        typed.text = "Dear Bob, v2";
        act(() => {
          window.dispatchEvent(new Event("focus"));
        });
        await waitFor(() =>
          expect(chip("outlook-draft")).toHaveAttribute(
            "data-state",
            "included",
          ),
        );
        expect(detailShows("Dear Bob, v2")).toBeInTheDocument();
      });

      it("reads the draft when its detail opens and keeps it current while open", async () => {
        vi.useFakeTimers();
        try {
          typeInDraft("Dear Bob");
          typed.text = "Dear Bob, hi";
          renderInput({ chatId: "chat-1" });
          await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
          });
          expect(detailShows("Dear Bob, hi")).toBeInTheDocument();
          const reads = typed.getAsync.mock.calls.length;

          typed.text = "Dear Bob, hi there";
          await act(async () => {
            await vi.advanceTimersByTimeAsync(DRAFT_DETAIL_REFRESH_MS);
          });
          expect(detailShows("Dear Bob, hi there")).toBeInTheDocument();
          expect(typed.getAsync.mock.calls.length).toBe(reads + 1);
        } finally {
          vi.useRealTimers();
        }
      });

      it("goes with the body read last once a host that never answers runs out of time", async () => {
        vi.useFakeTimers();
        try {
          typeInDraft("Dear Bob");
          typed.getAsync.mockImplementation(() => {});
          const { onSendMessage } = renderInput({ chatId: "chat-1" });

          send();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(LIVE_BODY_READ_TIMEOUT_MS - 1);
          });
          expect(onSendMessage).not.toHaveBeenCalled();
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
          });
          expect(onSendMessage).toHaveBeenCalledTimes(1);
          expect(facetOf(onSendMessage, 0)?.args?.full_body).toBe("Dear Bob");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("while scheduling", () => {
      beforeEach(() => {
        h.calendarFetcher = {};
        h.availableFacetArgs = new Map([
          ["outlook_review_draft", new Set<string>()],
          ["outlook_schedule", new Set<string>()],
        ]);
      });

      it("is not sent, and the mode chip next to + ends it", async () => {
        composeMessage("Dear Bob");
        const { onSendMessage } = renderInput({
          lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
        });

        expect(chip("outlook-draft")).toHaveAttribute(
          "data-state",
          "superseded",
        );
        expect(meta("outlook-draft")).toBe("Not sent while scheduling");
        expect(item("outlook-draft")?.estimate).toBeUndefined();
        const modes = h.chatInput.props.composerModes as ComposerMode[];
        expect(modes).toHaveLength(1);
        expect(modes[0]).toMatchObject({
          id: "outlook.scheduling",
          label: "Scheduling",
          icon: "clock",
          endLabel: "End scheduling",
          endedAnnouncement: "Scheduling ended. Your draft is sent again.",
        });
        expect(modes[0]?.description).toMatch(
          /^Scheduling stays on for an hour after Erato last read your calendar \(until .+\)\.$/,
        );

        endScheduling();

        expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
        expect(h.chatInput.props.composerModes).toEqual([]);
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
      });

      it("ends from the draft's detail too", async () => {
        composeMessage("Dear Bob");
        const { onSendMessage } = renderInput({
          lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
        });
        expect(
          item("outlook-draft")?.detail?.actions?.map((action) => [
            action.id,
            action.announcement,
          ]),
        ).toEqual([
          ["end-scheduling", "Scheduling ended. Your draft is sent again."],
        ]);

        detailAction("outlook-draft", "end-scheduling");

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");
      });

      it("promises no draft for one already sent unchanged", async () => {
        composeMessage("Dear Bob");
        const { onSendMessage, rerender, ui } = renderInput({
          chatId: "chat-1",
        });
        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");

        rerender(
          ui({
            lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
          }),
        );

        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );
        expect(item("outlook-draft")?.detail?.actions).toBeUndefined();
        const modes = h.chatInput.props.composerModes as ComposerMode[];
        expect(modes[0]?.endedAnnouncement).toBe("Scheduling ended.");

        endScheduling();
        expect(meta("outlook-draft")).toBe("Unchanged, not re-sent");
      });

      it("turns on again with a newer signal", () => {
        composeMessage("Dear Bob");
        const { rerender, ui } = renderInput({
          lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
        });
        endScheduling();

        rerender(
          ui({
            lastSchedulingSignalAt: new Date(Date.now() - 1_000).toISOString(),
          }),
        );

        expect(h.chatInput.props.composerModes).toHaveLength(1);
      });

      it("goes when the window closes", () => {
        vi.useFakeTimers();
        try {
          composeMessage("Dear Bob");
          renderInput({
            lastSchedulingSignalAt: new Date(
              Date.now() - SCHEDULING_THREAD_MAX_AGE_MS + 1_000,
            ).toISOString(),
          });
          expect(h.chatInput.props.composerModes).toHaveLength(1);

          act(() => {
            vi.advanceTimersByTime(1_001);
          });

          expect(h.chatInput.props.composerModes).toEqual([]);
          expect(chip("outlook-draft")).toHaveAttribute(
            "data-state",
            "included",
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("an appointment", () => {
      const bindTime = {
        subject: "Planning",
        organizer: null,
        requiredAttendees: [
          { displayName: "Bob", emailAddress: "bob@example.com" },
        ],
        optionalAttendees: [],
        location: "",
        start: new Date(2026, 9, 23, 10, 0),
        end: new Date(2026, 9, 23, 11, 0),
        bodyText: "Agenda",
        bodyHtml: null,
      };

      beforeEach(() => {
        h.mailItem = {
          ...bindTime,
          itemKind: "appointment",
          isComposeMode: true,
        };
        liveCompose({ itemType: "appointment" });
        h.availableFacetArgs = new Map([
          ["outlook_review_appointment", new Set<string>()],
        ]);
      });

      it("shows its span as meta and reads unchanged after the send", async () => {
        h.readAppointmentComposeSnapshot.mockResolvedValue({
          ...bindTime,
          location: "Room 3",
        });
        const { onSendMessage } = renderInput({ chatId: "chat-1" });
        expect(chip("outlook-draft")).toHaveAttribute(
          "data-testid",
          "context-chip-outlook.appointment",
        );
        expect(meta("outlook-draft")?.replace(/\s/gu, " ")).toBe(
          "Fri, Oct 23, 10:00 – 11:00 AM",
        );

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(facetOf(onSendMessage, 0)?.id).toBe(
          "outlook_review_appointment",
        );
        expect(facetOf(onSendMessage, 0)?.args?.location).toBe("Room 3");
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );
      });

      it("lists in its detail what the next send reads from the live form", async () => {
        h.readAppointmentComposeSnapshot.mockResolvedValue({
          ...bindTime,
          location: "Room 3",
        });
        renderInput({ chatId: "chat-1" });

        // Bind time knows no location; the live form does.
        await waitFor(() =>
          expect(
            within(chip("outlook-draft")).getByText("Room 3"),
          ).toBeInTheDocument(),
        );
        expect(
          within(chip("outlook-draft")).getByText("Where"),
        ).toBeInTheDocument();
        expect(
          within(chip("outlook-draft")).getByText("Bob"),
        ).toBeInTheDocument();
      });
    });

    describe("after edits the host reports", () => {
      const eventTypes = Office.EventType as unknown as Record<
        string,
        string | undefined
      >;
      const handlers = new Map<string, () => void>();
      const withHandlers = (extra: Record<string, unknown>) =>
        liveCompose({
          addHandlerAsync: (eventType: string, handler: () => void) => {
            handlers.set(eventType, handler);
          },
          removeHandlerAsync: (eventType: string) => {
            handlers.delete(eventType);
          },
          ...extra,
        });

      beforeEach(() => {
        handlers.clear();
        eventTypes.RecipientsChanged = "olkRecipientsChanged";
        eventTypes.AppointmentTimeChanged = "olkAppointmentTimeChanged";
      });
      afterEach(() => {
        delete eventTypes.RecipientsChanged;
        delete eventTypes.AppointmentTimeChanged;
      });

      it("re-includes the draft after a recipient edit and lists the recipients", async () => {
        let to = [{ displayName: "Mark", emailAddress: "mark@example.com" }];
        h.mailItem = {
          itemKind: "message",
          isComposeMode: true,
          bodyText: "Dear Bob",
          bodyHtml: null,
          subject: "",
          to: [],
          cc: [],
        };
        withHandlers({
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
        await waitFor(() =>
          expect(chip("outlook-draft")).toHaveAttribute(
            "data-state",
            "superseded",
          ),
        );

        to = [...to, { displayName: "Ana", emailAddress: "ana@example.com" }];
        act(() => handlers.get("olkRecipientsChanged")?.());
        await waitFor(() =>
          expect(chip("outlook-draft")).toHaveAttribute(
            "data-state",
            "included",
          ),
        );
        expect(
          within(chip("outlook-draft")).getByText("Mark, Ana"),
        ).toBeInTheDocument();

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
        expect(facetOf(onSendMessage, 1)?.args?.recipients).toBe(
          JSON.stringify({ to }),
        );
      });

      it("re-includes appointment details after a time edit", async () => {
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
        withHandlers({ itemType: "appointment" });
        h.availableFacetArgs = new Map([
          ["outlook_review_appointment", new Set<string>()],
        ]);
        h.readAppointmentComposeSnapshot.mockResolvedValue(bindTime);
        const { onSendMessage } = renderInput({ chatId: "chat-1" });

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        await waitFor(() =>
          expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
        );

        h.readAppointmentComposeSnapshot.mockResolvedValue({
          ...bindTime,
          start: new Date("2026-08-11T08:00:00.000Z"),
          end: new Date("2026-08-11T09:00:00.000Z"),
        });
        act(() => handlers.get("olkAppointmentTimeChanged")?.());
        await waitFor(() =>
          expect(chip("outlook-draft")).toHaveAttribute(
            "data-state",
            "included",
          ),
        );

        send();
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
        expect(facetOf(onSendMessage, 1)?.id).toBe(
          "outlook_review_appointment",
        );
      });
    });
  });

  describe("the selection", () => {
    const longSelection = `${"a".repeat(79)}😀 and the rest of it`;

    beforeEach(() => {
      composeMessage("Dear Bob");
      h.availableFacetArgs = new Map([
        ["outlook_review_draft", new Set<string>()],
      ]);
      h.composeSelection = { data: longSelection, sourceProperty: "body" };
    });

    it("replaces the draft, cut at a code point, with no announced glyph", () => {
      renderInput();

      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "included",
      );
      expect(meta("outlook-selection")).toBe("Replaces draft");
      expect(
        within(chip("outlook-selection")).getByTestId("context-chip-label"),
      ).toHaveTextContent(`“${"a".repeat(60)}…”`);
      expect(screen.queryByText("✂", { exact: false })).toBeNull();
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "superseded");
      expect(meta("outlook-draft")).toBe("Replaced by selection");
    });

    it("gives the draft back on (x), and the rewrite on (+)", async () => {
      const { onSendMessage } = renderInput();

      press("outlook-selection", "Dismiss selection");
      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(facetOf(onSendMessage, 0)?.id).toBe("outlook_review_draft");

      press("outlook-selection", "Include selection");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(facetOf(onSendMessage, 1)?.id).toBe("outlook_rewrite_selection");
    });

    it("sends the draft instead from its detail", () => {
      renderInput();
      expect(
        item("outlook-draft")?.detail?.actions?.map((action) => [
          action.id,
          action.label,
          action.announcement,
        ]),
      ).toEqual([
        [
          "send-instead",
          "Send this instead",
          "Draft included. Your selection is off until it changes.",
        ],
      ]);

      detailAction("outlook-draft", "send-instead");

      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(chip("outlook-draft")).toHaveAttribute("data-state", "included");
    });

    it("replaces nothing when the draft went unchanged already", async () => {
      h.composeSelection = { data: "", sourceProperty: "body" };
      const { onSendMessage, rerender, ui } = renderInput({ chatId: "chat-1" });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));

      h.composeSelection = { data: longSelection, sourceProperty: "body" };
      rerender(ui());

      await waitFor(() =>
        expect(meta("outlook-draft")).toBe("Unchanged, not re-sent"),
      );
      expect(meta("outlook-selection")).toBe("Selected text");
      expect(item("outlook-draft")?.detail?.actions).toBeUndefined();
    });

    it("stays off until the selection or the item changes (ERMAIN-431)", () => {
      const { rerender, ui } = renderInput();
      press("outlook-selection", "Dismiss selection");

      h.composeSelection = { data: "", sourceProperty: "body" };
      rerender(ui());
      h.composeSelection = { data: longSelection, sourceProperty: "body" };
      rerender(ui());
      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "included",
      );

      press("outlook-selection", "Dismiss selection");
      h.itemIdentity = "item-2";
      rerender(ui());
      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "included",
      );

      press("outlook-selection", "Dismiss selection");
      h.composeSelection = { data: "Another passage", sourceProperty: "body" };
      rerender(ui());
      expect(chip("outlook-selection")).toHaveAttribute(
        "data-state",
        "included",
      );
    });
  });

  describe("draft attachments", () => {
    const attachment = (
      id: string,
      over: Partial<OutlookItemAttachment> = {},
    ): OutlookItemAttachment => ({
      id,
      name: `${id}.pdf`,
      size: 100,
      contentType: "application/pdf",
      cloud: false,
      ...over,
    });

    beforeEach(() => {
      composeMessage("");
    });

    it("sends two as one chip each, and only the one left in after (x)", async () => {
      setSource({ itemAttachments: [attachment("a"), attachment("b")] });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(meta("outlook-attachment:a")).toBe("Draft attachment · 100 B");
      // The detail names the type as the file tiles do, not by MIME type.
      expect(
        within(chip("outlook-attachment:a")).getByText("PDF"),
      ).toBeTruthy();
      expect(
        within(chip("outlook-attachment:a")).queryByText("application/pdf"),
      ).toBeNull();

      press("outlook-attachment:a", "Don't include a.pdf");
      expect(chip("outlook-attachment:a")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      send();

      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["b.pdf"]);
    });

    it("groups three, counts the ticks, and keeps them through (x) and (+)", async () => {
      setSource({
        itemAttachments: [attachment("a"), attachment("b"), attachment("c")],
      });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(meta("outlook-attachments")).toBe("3 of 3 · 300 B");

      fireEvent.click(screen.getByTestId("row-c"));
      expect(meta("outlook-attachments")).toBe("2 of 3 · 200 B");

      press("outlook-attachments", "Don't include draft attachments");
      expect(chip("outlook-attachments")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual([]);

      press("outlook-attachments", "Include draft attachments");
      expect(meta("outlook-attachments")).toBe("2 of 3 · 200 B");
    });

    it("never sends a cloud file", async () => {
      setSource({
        itemAttachments: [
          attachment("a"),
          attachment("cloud", { cloud: true }),
        ],
      });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(chip("outlook-attachment:cloud")).toHaveAttribute(
        "data-state",
        "error",
      );
      expect(meta("outlook-attachment:cloud")).toBe(
        "Cloud file · can't be sent",
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["a.pdf"]);
    });

    it("on a follow-up, reads the sent one as sent earlier and offers the other for one message", async () => {
      setSource({ itemAttachments: [attachment("a")] });
      const { onSendMessage, rerender, ui } = renderInput({
        chatId: "chat-1",
        freshChat: true,
      });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));

      setSource({ itemAttachments: [attachment("a"), attachment("b")] });
      rerender(ui({ freshChat: false }));
      await waitFor(() =>
        expect(meta("outlook-attachment:a")).toBe("Sent earlier, not re-sent"),
      );
      expect(chip("outlook-attachment:b")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(meta("outlook-attachment:b")).toBe(
        "Not included on follow-up messages",
      );

      press("outlook-attachment:b", "Include b.pdf");
      expect(chip("outlook-attachment:b")).toHaveAttribute(
        "data-state",
        "included",
      );
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(uploadedNames()).toEqual(["a.pdf", "b.pdf"]);
      await waitFor(() =>
        expect(meta("outlook-attachment:b")).toBe("Sent earlier, not re-sent"),
      );
    });

    it("includes only the follow-up attachment (+) was pressed on", async () => {
      setSource({ itemAttachments: [attachment("a"), attachment("b")] });
      const { onSendMessage } = renderInput({
        chatId: "chat-1",
        freshChat: false,
      });

      press("outlook-attachment:a", "Include a.pdf");
      send();

      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["a.pdf"]);
    });

    it("says a staged drop keeps them back, and sends only the drop", async () => {
      setSource({ itemAttachments: [attachment("a")] });
      stageDrop();
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(meta("outlook-attachment:a")).toBe("Not sent with dropped emails");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["quarterly.eml"]);
    });

    it("shows none while Office.js still reports them", () => {
      setSource({
        itemAttachments: [attachment("a")],
        isLoadingAttachments: true,
      });
      renderInput({ freshChat: true });
      expect(queryChip("outlook-attachment:a")).toBeNull();
    });

    it("never reads sent earlier on a chat whose send never arrived", async () => {
      setSource({ itemAttachments: [attachment("a")] });
      const { onSendMessage, rerender, ui } = renderInput({
        chatId: "chat-1",
        freshChat: true,
      });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));

      rerender(ui({ freshChat: true }));

      expect(meta("outlook-attachment:a")).toBe("Draft attachment · 100 B");
    });

    it("stays included and records nothing when the upload fails", async () => {
      setSource({ itemAttachments: [attachment("a")] });
      h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
      const { onSendMessage, rerender, ui } = renderInput({
        chatId: "chat-1",
        freshChat: true,
      });

      send();
      await expectDeclinedSend(onSendMessage);

      expect(chip("outlook-attachment:a")).toHaveAttribute(
        "data-state",
        "included",
      );
      expect(recordedSends()).toEqual([]);
      rerender(ui({ freshChat: false }));
      expect(meta("outlook-attachment:a")).toBe(
        "Not included on follow-up messages",
      );
    });

    it("gives a single chip's (x) and the group's (x) one lifetime: this chat and item", () => {
      setSource({ itemAttachments: [attachment("a"), attachment("b")] });
      const { rerender, ui } = renderInput({
        chatId: "chat-1",
        freshChat: true,
      });
      press("outlook-attachment:a", "Don't include a.pdf");
      expect(chip("outlook-attachment:a")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      // The provider's tick stays: the (x) is the chip's, not the checklist's.
      expect(source().removeAttachment).not.toHaveBeenCalled();

      rerender(ui({ chatId: "chat-2" }));
      expect(chip("outlook-attachment:a")).toHaveAttribute(
        "data-state",
        "included",
      );

      setSource({
        itemAttachments: [attachment("a"), attachment("b"), attachment("c")],
      });
      press("outlook-attachments", "Don't include draft attachments");
      rerender(ui({ chatId: "chat-3" }));
      expect(chip("outlook-attachments")).toHaveAttribute(
        "data-state",
        "included",
      );
    });

    it("says a group of cloud links can't go, and its (x) dismisses it", () => {
      setSource({
        itemAttachments: ["x", "y", "z"].map((id) =>
          attachment(id, { cloud: true, size: 0 }),
        ),
      });
      renderInput({ freshChat: true });
      expect(chip("outlook-attachments")).toHaveAttribute(
        "data-state",
        "error",
      );
      expect(meta("outlook-attachments")).toBe("Cloud files · can't be sent");

      press("outlook-attachments", "Dismiss draft attachments");
      expect(chip("outlook-attachments")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(menuState().attachments).toBe("in-composer");
    });
  });

  describe("the open thread", () => {
    beforeEach(() => {
      readItem();
      stageThread();
    });

    it("goes with a fresh chat, with its stats and the file it uploads as the estimate", async () => {
      const ref = createRef<string | null>() as { current: string | null };
      const { onSendMessage, rerender, ui } = renderInput({
        freshChat: true,
        includedEmailMessageIdRef: ref,
      });

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      expect(meta("outlook-thread")).toBe(
        `5 messages · ${threadFile.size} B of 1 KB`,
      );
      expect(item("outlook-thread")?.estimate).toBe(threadFile);
      expect(h.chatInput.props).not.toHaveProperty("virtualFiles");
      expect(ref.current).toBe("<open@x>");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["conversation.eml"]);
      // The chat has its first message: sent in this chat, no chip, and the
      // "+" menu adds it again.
      rerender(ui({ freshChat: false }));
      await waitFor(() => expect(queryChip("outlook-thread")).toBeNull());
      expect(ref.current).toBeNull();
      expect(menuState().thread).toBe("add-again");
    });

    it("holds the composer until the file it uploads matches the latest ticks", async () => {
      setSource({ threadFile: null, isThreadEmlStale: true });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      expect(meta("outlook-thread")).toBe("5 messages · Updating…");
      expect(composerDisabled()).toBe("true");

      setSource({ threadFile, isThreadEmlStale: false });
      expect(composerDisabled()).toBe("false");

      // An untick: until the rebuild the file still holds message m2.
      stageThread({ dismissed: ["m2"] });
      setSource({ isThreadEmlStale: true });
      expect(meta("outlook-thread")).toBe("4 of 5 messages · Updating…");
      expect(composerDisabled()).toBe("true");

      const rebuilt = new File(["four"], "conversation.eml");
      setSource({ threadFile: rebuilt, isThreadEmlStale: false });
      expect(composerDisabled()).toBe("false");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      const uploaded = h.fetchUploadFile.mock.calls[0]?.[0] as {
        body: FormData;
      };
      expect((uploaded.body.get("file") as File).size).toBe(rebuilt.size);
    });

    it("comes back when the send never reached the chat", async () => {
      const { onSendMessage, rerender, ui } = renderInput({ freshChat: true });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));

      // The host dropped the send before the server saw it: still a fresh chat.
      rerender(ui({ freshChat: true }));

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      expect(menuState().thread).toBe("in-composer");
    });

    it("records nothing for a send whose upload failed", async () => {
      stageDrop();
      h.fetchUploadFile.mockRejectedValueOnce(new Error("network down"));
      const { onSendMessage, rerender, ui } = renderInput({ freshChat: true });
      const included = meta("outlook-thread");

      send();
      await expectDeclinedSend(onSendMessage);

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      expect(meta("outlook-thread")).toBe(included);
      expect(recordedSends()).toEqual([]);
      // Nothing claims it went: a follow-up offers it rather than hiding it.
      rerender(ui({ freshChat: false }));
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");
    });

    it("lists every message in its detail, none folded behind Show more", () => {
      stageThread({ dismissed: ["m4", "m5"] });
      renderInput({ freshChat: true });

      expect(Object.values(h.checklistVisibleItems)).toEqual([
        Number.POSITIVE_INFINITY,
      ]);
    });

    it("keeps the partial choice through (x) and (+)", async () => {
      stageThread({ dismissed: ["m4", "m5"] });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(meta("outlook-thread")).toBe(
        `3 of 5 messages · ${threadFile.size} B of 1 KB`,
      );

      press("outlook-thread", "Leave out the email");
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual([]);

      press("outlook-thread", "Include the email");
      expect(meta("outlook-thread")).toBe(
        `3 of 5 messages · ${threadFile.size} B of 1 KB`,
      );
      expect(item("outlook-thread")?.announcements?.restored).toBe(
        "Email thread included. Your earlier choice is back.",
      );
    });

    it("brings it back when a box is ticked while it is left out", () => {
      renderInput({ freshChat: true });
      press("outlook-thread", "Leave out the email");

      fireEvent.click(screen.getByTestId("row-m2"));

      expect(source().dismissStagedEmailBody).toHaveBeenCalledWith("m2");
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
    });

    it("offers every message back when none is ticked", () => {
      stageThread({ dismissed: ["m1", "m2", "m3", "m4", "m5"], file: null });
      renderInput({ freshChat: true });
      expect(meta("outlook-thread")).toBe("Nothing chosen");

      press("outlook-thread", "Include every message");

      expect(source().restoreEmailBody).toHaveBeenCalledTimes(1);
    });

    it("holds the composer while it loads, and frees it on (x)", async () => {
      setSource({
        threadStatus: "loading",
        stagedEmails: [],
        currentThread: null,
        threadFile: null,
      });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "loading");
      expect(meta("outlook-thread")).toBe("Loading email thread…");
      expect(screen.getByTestId("chat-input")).toHaveAttribute(
        "data-disabled",
        "true",
      );

      press("outlook-thread", "Leave out the email");

      expect(screen.getByTestId("chat-input")).toHaveAttribute(
        "data-disabled",
        "false",
      );
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual([]);
    });

    it("reports a failed load, retries from its detail, and loads again first after (x)", () => {
      setSource({
        threadStatus: "error",
        stagedEmails: [],
        currentThread: null,
        threadFile: null,
      });
      renderInput({ freshChat: true });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "error");
      expect(meta("outlook-thread")).toBe("Couldn't load the email thread");
      expect(
        item("outlook-thread")?.detail?.actions?.map((action) => [
          action.id,
          action.label,
          action.announcement,
        ]),
      ).toEqual([["retry", "Try again", "Email thread loaded."]]);

      detailAction("outlook-thread", "retry");
      expect(source().retryEmailThread).toHaveBeenCalledTimes(1);
      expect(outlookContextStore.getSnapshot().size).toBe(1);
      expect(
        [...outlookContextStore.getSnapshot().values()][0]?.thread.choice,
      ).toBe("included");

      press("outlook-thread", "Dismiss email thread");
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");

      press("outlook-thread", "Try loading the email again");
      expect(source().retryEmailThread).toHaveBeenCalledTimes(2);
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "error");
    });

    it("keeps a follow-up's failed load quiet, and (+) loads it again and sends it", async () => {
      setSource({
        threadStatus: "error",
        emailThreadSignIn: "sign-in",
        stagedEmails: [],
        currentThread: null,
        threadFile: null,
      });
      const { onSendMessage } = renderInput({
        chatId: "chat-1",
        freshChat: false,
      });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");
      expect(meta("outlook-thread")).toBe("Not included on follow-up messages");
      expect(item("outlook-thread")?.detail?.actions).toBeUndefined();

      press("outlook-thread", "Include the email");
      expect(source().retryEmailThread).toHaveBeenCalledTimes(1);
      // The reload lands; the email goes with this message.
      stageThread();
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["conversation.eml"]);
    });

    it("sends the email it signed in for on a follow-up", async () => {
      const { onSendMessage } = renderInput({
        chatId: "chat-1",
        freshChat: false,
      });
      press("outlook-thread", "Include the email");
      // The included load then needed a sign-in.
      setSource({
        threadStatus: "error",
        emailThreadSignIn: "sign-in",
        stagedEmails: [],
        currentThread: null,
        threadFile: null,
      });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "attention");

      detailAction("outlook-thread", "sign-in");
      expect(source().signInForEmail).toHaveBeenCalledTimes(1);
      setSource({ emailThreadSignIn: null });
      stageThread();

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["conversation.eml"]);
    });

    it("asks for a sign-in in its detail, and for access where a grant is missing", () => {
      setSource({
        threadStatus: "error",
        emailThreadSignIn: "sign-in",
        stagedEmails: [],
        currentThread: null,
        threadFile: null,
      });
      const { rerender, ui } = renderInput({ freshChat: true });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "attention");
      expect(meta("outlook-thread")).toBe("Sign in to load email");

      detailAction("outlook-thread", "sign-in");
      expect(source().signInForEmail).toHaveBeenCalledTimes(1);

      setSource({ emailThreadSignIn: "consent" });
      rerender(ui());
      expect(meta("outlook-thread")).toBe("Allow access to load email");
      expect(
        chip("outlook-thread").querySelector('[data-action-id="sign-in"]'),
      ).toHaveTextContent("Allow access");
    });

    it("says a trim the bytes refuse, and lets a send go without the thread", async () => {
      setSource({
        threadTrimError: new EmailTrimError("Forwarded.eml"),
        threadFile: null,
      });
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "error");
      expect(meta("outlook-thread")).toBe("Couldn't leave out unticked parts");

      press("outlook-thread", "Dismiss email thread");
      send();

      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual([]);
    });

    it("is offered, never sent, on a follow-up; (+) sends it once", async () => {
      const { onSendMessage } = renderInput({
        chatId: "chat-1",
        freshChat: false,
      });
      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");
      expect(meta("outlook-thread")).toBe("Not included on follow-up messages");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual([]);

      press("outlook-thread", "Include the email");
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
      expect(uploadedNames()).toEqual(["conversation.eml"]);
      await waitFor(() => expect(queryChip("outlook-thread")).toBeNull());
    });

    it("shows an email sent in this chat as suggested once the user comes back to it", async () => {
      const { onSendMessage, rerender, ui } = renderInput({
        chatId: "chat-1",
        freshChat: true,
      });
      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      rerender(ui({ freshChat: false }));
      await waitFor(() => expect(queryChip("outlook-thread")).toBeNull());

      h.itemIdentity = "item-2";
      rerender(ui({ freshChat: false }));
      h.itemIdentity = "item-1";
      rerender(ui({ freshChat: false }));

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "suggested");
      expect(meta("outlook-thread")).toBe("Not included on follow-up messages");
      expect(menuState().thread).toBe("in-composer");
    });

    it("resets the choice on another item", () => {
      const { rerender, ui } = renderInput({ freshChat: true });
      press("outlook-thread", "Leave out the email");

      h.itemIdentity = "item-2";
      rerender(ui());

      expect(chip("outlook-thread")).toHaveAttribute("data-state", "included");
    });

    it("stands back for its own drop", async () => {
      stageDrop();
      const { onSendMessage } = renderInput({
        freshChat: false,
        openEmailStagedAsDrop: true,
      });
      expect(queryChip("outlook-thread")).toBeNull();

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["quarterly.eml"]);
    });

    it("sends only the drop on a follow-up", async () => {
      stageDrop();
      const { onSendMessage } = renderInput({ freshChat: false });
      expect(meta("outlook-thread")).toBe("Not included on follow-up messages");

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["quarterly.eml"]);
    });

    it("measures the thread's own file, not the drop staged beside it", async () => {
      stageDrop();
      const { onSendMessage } = renderInput({ freshChat: true });
      expect(meta("outlook-thread")).toBe(
        `5 messages · ${threadFile.size} B of 1 KB`,
      );

      send();
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect(uploadedNames()).toEqual(["conversation.eml", "quarterly.eml"]);
    });

    it("lets the + menu add an attachment as its own file wherever no chip carries it", () => {
      const { rerender, ui } = renderInput({ freshChat: true });
      expect(menuState().attachments).toBe("in-composer");

      rerender(ui({ freshChat: false }));
      expect(meta("outlook-thread")).toBe("Not included on follow-up messages");
      expect(menuState().attachments).toBe("upload");

      press("outlook-thread", "Include the email");
      expect(menuState().attachments).toBe("in-composer");

      press("outlook-thread", "Leave out the email");
      expect(menuState().attachments).toBe("upload");
    });

    it("never sends Office.js attachments beside the thread", () => {
      setSource({
        itemAttachments: [
          {
            id: "a",
            name: "contract-v3.pdf",
            size: 10,
            contentType: "application/pdf",
            cloud: false,
          },
        ],
      });
      renderInput({ freshChat: true });
      expect(queryChip("outlook-attachment:a")).toBeNull();
    });
  });

  describe("dropped emails", () => {
    it("draws one chip per drop and removes it on (x)", () => {
      stageDrop(
        emlFile.size,
        droppedEmail({
          subject: "Re: Offsite agenda",
          date: new Date(2026, 9, 7, 12).toISOString(),
          attachments: [
            {
              id: "att-0",
              filename: "agenda.docx",
              mimeType: "application/msword",
              size: 3,
              disposition: "attachment",
              related: false,
              contentId: null,
              toFile: () => new File([], "agenda.docx"),
            },
          ],
        }),
      );
      const { onEmailSourceDropsSent } = renderInput();
      const id = `outlook-drop:${DROP_KEY}`;
      expect(chip(id)).toHaveAttribute("data-origin", "user");
      expect(meta(id)).toBe("Lena Hoffmann • 10/7/2026 · 1/1 attachment");
      expect(item(id)?.estimate).toBe(emlFile);

      press(id, "Remove Re: Offsite agenda");

      expect(onEmailSourceDropsSent).toHaveBeenCalledWith([
        { key: DROP_KEY, messageId: "<quarterly@x>" },
      ]);
      // The lane hands focus on; the wrapper no longer does.
      expect(h.controls.focusInput).not.toHaveBeenCalled();
    });

    it("keeps the body read-only in the detail and hands attachment ticks to the provider", () => {
      stageDrop(
        emlFile.size,
        droppedEmail({
          attachments: [
            {
              id: "att-0",
              filename: "agenda.docx",
              mimeType: "application/msword",
              size: 3,
              disposition: "attachment",
              related: false,
              contentId: null,
              toFile: () => new File([], "agenda.docx"),
            },
          ],
        }),
      );
      renderInput();

      const body = screen.getByTestId(`row-${DROP_KEY}:body`);
      expect(body).toBeDisabled();
      expect(body).toHaveAttribute(
        "data-meta",
        `Email · ${emlFile.size} B · Always sent`,
      );
      fireEvent.click(screen.getByTestId(`row-${DROP_KEY}:att-0`));
      expect(source().dismissStagedEmailAttachment).toHaveBeenCalledWith(
        DROP_KEY,
        "att-0",
      );
    });

    it("shows one locked progress chip while drops are read, and says start and end", () => {
      const { rerender, ui } = renderInput({
        isExpandingDroppedEmails: true,
        dropPipeline: { phase: "reading", done: 1, total: 2, name: undefined },
      });
      const progress = chip("outlook-drop-progress");
      expect(progress).toHaveAttribute("data-state", "loading");
      expect(progress).toHaveAttribute("data-locked", "true");
      expect(within(progress).queryByRole("button")).toBeNull();
      expect(
        within(progress).getByTestId("context-chip-label"),
      ).toHaveTextContent("Reading email 1 of 2…");
      expect(item("outlook-drop-progress")?.lockReason).toBe(
        "Dropped emails can't be cancelled while Erato reads them",
      );
      expect(screen.getByTestId("outlook-drop-announcer")).toHaveTextContent(
        "Reading 2 dropped emails.",
      );

      stageDrop();
      rerender(ui({ isExpandingDroppedEmails: false }));

      expect(queryChip("outlook-drop-progress")).toBeNull();
      expect(screen.getByTestId("outlook-drop-announcer")).toHaveTextContent(
        "1 email added.",
      );
    });
  });

  it("locks every chip and the mode while a send uploads", async () => {
    composeMessage("Dear Bob");
    h.calendarFetcher = {};
    h.availableFacetArgs = new Map([
      ["outlook_review_draft", new Set<string>()],
      ["outlook_schedule", new Set<string>()],
    ]);
    stageDrop();
    let finish: (() => void) | null = null;
    h.fetchUploadFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ files: [{ id: "u1" }] });
        }),
    );
    renderInput({
      lastSchedulingSignalAt: new Date(Date.now() - 60_000).toISOString(),
    });

    send();

    const reason = "Can't change this while the message is being sent";
    await waitFor(() =>
      expect(item(`outlook-drop:${DROP_KEY}`)?.locked).toBe(true),
    );
    for (const entry of items()) {
      expect(entry.locked).toBe(true);
      expect(entry.lockReason).toBe(reason);
    }
    expect(modeButton("End scheduling")).toBeDisabled();
    await act(async () => finish?.());
  });

  it("hands the lane every Outlook item with its contract", () => {
    composeMessage("Dear Bob");
    h.availableFacetArgs = new Map([
      ["outlook_review_draft", new Set<string>()],
    ]);
    h.composeSelection = { data: "Dear", sourceProperty: "body" };
    stageDrop();
    renderInput({ freshChat: true });

    expect(
      items().map((entry) => [
        entry.id,
        entry.kind,
        entry.origin,
        entry.dismissScope,
        entry.icon,
        entry.spokenLabel,
      ]),
    ).toEqual([
      [
        "outlook-selection",
        "outlook.selection",
        "ambient",
        "selection",
        "selection",
        "Selection",
      ],
      ["outlook-draft", "outlook.draft", "ambient", "item", "draft", "Draft"],
      [
        `outlook-drop:${DROP_KEY}`,
        "outlook.droppedEmail",
        "user",
        undefined,
        "mail",
        undefined,
      ],
    ]);
    expect(item("outlook-selection")).toMatchObject({
      removeLabel: "Dismiss selection",
    });
    expect(item("outlook-draft")).toMatchObject({
      removeLabel: "Don't include draft",
      detail: { title: "Your draft" },
    });
    expect(h.chatInput.props.composerModes).toEqual([]);
  });
});
