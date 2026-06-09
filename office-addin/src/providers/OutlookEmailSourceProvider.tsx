import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useGraphToken } from "./EntraGraphTokenProvider";
import { useOutlookMailItem } from "./OutlookMailItemProvider";
import { useCurrentThread } from "../hooks/useCurrentThread";
import { buildThreadEmlFile } from "../utils/buildThreadEmlFile";
import { fetchParentMessageInConversationViaGraph } from "../utils/fetchOutlookMessageGraph";
import {
  OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
  runWithGraphTimeout,
} from "../utils/graphRequestTimeout";
import {
  dismissAttachment as applyDismissAttachment,
  dismissBody as applyDismissBody,
  restoreAttachment as applyRestoreAttachment,
  restoreBody as applyRestoreBody,
} from "../utils/stagedEmailDismissals";
import { trimEmlAttachments } from "../utils/trimEmlAttachments";

import type { ParentMessageMetadata } from "../utils/fetchOutlookMessageGraph";
import type { ParsedEmail } from "../utils/parsedEmail";
import type { ParsedThread, ThreadMessage } from "../utils/parsedThread";
import type { StagedEmailDismissalsMap } from "../utils/stagedEmailDismissals";
import type { LocalFilePreviewItem } from "@erato/frontend/library";
import type { ReactNode } from "react";

const OUTLOOK_CLOUD_ATTACHMENT_TYPE = "cloud";
const GRAPH_MAIL_SCOPES = ["Mail.Read"];

function generateDroppedKey(): string {
  return `drop-${globalThis.crypto.randomUUID()}`;
}

function collectDismissedIndices(
  attachments: { id: string }[],
  dismissedIds: ReadonlySet<string>,
): number[] {
  const indices: number[] = [];
  attachments.forEach((attachment, index) => {
    if (dismissedIds.has(attachment.id)) {
      indices.push(index);
    }
  });
  return indices;
}

async function trimRawEmlBytes(
  rawEmlFile: File,
  indicesToRemove: number[],
): Promise<File> {
  const buffer = await rawEmlFile.arrayBuffer();
  const trimmed = trimEmlAttachments(new Uint8Array(buffer), indicesToRemove);
  if (!trimmed) {
    console.warn(
      "[OutlookEmailSourceProvider] surgical trim returned null; uploading the original .eml",
    );
    return rawEmlFile;
  }
  return new File([trimmed.slice()], rawEmlFile.name, {
    type: rawEmlFile.type,
  });
}

export type StagedEmailSource = "current-thread" | "drop";

/**
 * Discriminated union driving the staged-input UI:
 *
 * - `current-thread` — the currently-open Outlook conversation, fetched via
 *   Graph as a single `$filter=conversationId&$expand=attachments` call and
 *   represented as a `ParsedThread`. Rendered as one nested card per thread
 *   (sender/date sub-headers, per-message body + attachment checkboxes).
 *
 * - `drop` — a single `.eml` dragged onto the chat. Rendered as a flat card
 *   matching the pre-thread behaviour. Each drop is independent.
 *
 * Dismissals for both variants share the same `emailDismissals` map keyed by
 * RFC 5322 Message-ID — uniformly per-message-per-attachment.
 */
export type StagedEmail =
  | {
      key: string;
      source: "current-thread";
      thread: ParsedThread;
      /** Set of thread-message ids whose body the user excluded. */
      dismissedMessageIds: ReadonlySet<string>;
      /** Set of `${messageId}:${attachmentId}` keys the user excluded. */
      dismissedAttachmentIds: ReadonlySet<string>;
    }
  | {
      key: string;
      source: "drop";
      parsed: ParsedEmail;
      bodyDismissed: boolean;
      dismissedAttachmentIds: ReadonlySet<string>;
    };

interface DroppedEmailEntry {
  key: string;
  parsed: ParsedEmail;
}

interface OutlookEmailSourceContextValue {
  emailSubject: string;
  isEmailBodyIncluded: boolean;
  emailBodyFile: File | null;
  /**
   * True while the synthesized thread `.eml` (and therefore `emailBodyFile`'s
   * size / token estimate) is being recomputed after a dismissal toggle. The
   * checkbox state has already updated; this only signals that the derived
   * file is catching up. Lets the UI show an "Updating…" hint on large threads
   * instead of appearing frozen.
   */
  isThreadEmlStale: boolean;
  isLoadingEmailBody: boolean;
  /**
   * True when the open conversation failed to load entirely (Graph fetch
   * errored on the first page). Surfaced so the UI can warn the user rather
   * than silently presenting an empty thread (INV-7).
   */
  emailThreadLoadError: boolean;
  currentThread: ParsedThread | null;
  stagedEmails: StagedEmail[];
  dismissStagedEmailBody: (key: string) => void;
  restoreStagedEmailBody: (key: string) => void;
  dismissStagedEmailAttachment: (key: string, attachmentId: string) => void;
  restoreStagedEmailAttachment: (key: string, attachmentId: string) => void;
  addDroppedEmail: (parsed: ParsedEmail) => string | null;
  removeDroppedEmail: (key: string) => void;
  selectedAttachmentItems: LocalFilePreviewItem[];
  isLoadingAttachments: boolean;
  removeEmailBody: () => void;
  removeAttachment: (attachmentId: string) => void;
  restoreEmailBody: () => void;
  restoreAttachment: (attachmentId: string) => void;
  isEmailBodyDismissed: boolean;
  dismissedAttachmentIds: string[];
  resolveSelectedFilesForSend: () => Promise<File[]>;
  hasSelectedEmailSource: boolean;
  parentReplyContext: ParentMessageMetadata | null;
  isLoadingParentReplyContext: boolean;
}

const defaultValue: OutlookEmailSourceContextValue = {
  emailSubject: "",
  isEmailBodyIncluded: false,
  emailBodyFile: null,
  isThreadEmlStale: false,
  isLoadingEmailBody: false,
  emailThreadLoadError: false,
  currentThread: null,
  stagedEmails: [],
  dismissStagedEmailBody: () => {},
  restoreStagedEmailBody: () => {},
  dismissStagedEmailAttachment: () => {},
  restoreStagedEmailAttachment: () => {},
  addDroppedEmail: () => null,
  removeDroppedEmail: () => {},
  selectedAttachmentItems: [],
  isLoadingAttachments: false,
  removeEmailBody: () => {},
  removeAttachment: () => {},
  restoreEmailBody: () => {},
  restoreAttachment: () => {},
  isEmailBodyDismissed: false,
  dismissedAttachmentIds: [],
  resolveSelectedFilesForSend: async () => [],
  hasSelectedEmailSource: false,
  parentReplyContext: null,
  isLoadingParentReplyContext: false,
};

const OutlookEmailSourceContext =
  createContext<OutlookEmailSourceContextValue>(defaultValue);

export function useOutlookEmailSource(): OutlookEmailSourceContextValue {
  return useContext(OutlookEmailSourceContext);
}

export function OutlookEmailSourceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    itemIdentity,
    mailItem,
    attachments,
    isLoadingAttachments,
    getAttachmentFile,
  } = useOutlookMailItem();
  const { acquireToken } = useGraphToken();
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<
    string[]
  >([]);
  const [parentReplyContext, setParentReplyContext] =
    useState<ParentMessageMetadata | null>(null);
  const [isLoadingParentReplyContext, setIsLoadingParentReplyContext] =
    useState(false);
  const [emailDismissals, setEmailDismissals] =
    useState<StagedEmailDismissalsMap>(() => new Map());
  const [droppedEmails, setDroppedEmails] = useState<DroppedEmailEntry[]>([]);

  const acquireGraphToken = useCallback(
    (options?: { forceRefresh?: boolean }) =>
      acquireToken(GRAPH_MAIL_SCOPES, options),
    [acquireToken],
  );

  const itemId = mailItem?.itemId ?? null;
  const conversationId = mailItem?.conversationId ?? null;
  const isComposeMode = mailItem?.isComposeMode ?? false;

  // Conversation fetch lives in its own hook so it can be unit-tested in
  // isolation against an injected Graph transport.
  const {
    thread: currentThread,
    isLoading: isLoadingEmailBody,
    error: emailThreadLoadError,
  } = useCurrentThread(itemId, conversationId, acquireGraphToken);

  // Reply-context chip for compose mode (drafts have no itemId but do have a
  // conversationId). Display-only — the parent body reaches the LLM via the
  // draft's auto-quote + the `outlook_review_draft.full_body` action facet.
  useEffect(() => {
    if (!isComposeMode || !conversationId || itemId) {
      setParentReplyContext(null);
      setIsLoadingParentReplyContext(false);
      return;
    }

    const controller = new AbortController();
    setIsLoadingParentReplyContext(true);
    setParentReplyContext(null);

    void runWithGraphTimeout(
      OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS,
      `Outlook reply-context fetch timed out after ${OUTLOOK_GRAPH_MESSAGE_TIMEOUT_MS}ms`,
      controller.signal,
      (signal) =>
        fetchParentMessageInConversationViaGraph(
          conversationId,
          acquireGraphToken,
          { signal },
        ),
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setParentReplyContext(result);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setIsLoadingParentReplyContext(false);
      });

    return () => {
      controller.abort();
    };
  }, [acquireGraphToken, conversationId, isComposeMode, itemId]);

  // Office.js attachment ids are per-item; flush the dismissal list when
  // the host mail item changes so stale ids don't leak. Thread + drop
  // dismissals (`emailDismissals`) are keyed by Message-ID and don't need
  // this scope-flush.
  useEffect(() => {
    setDismissedAttachmentIds([]);
  }, [itemIdentity]);

  const threadStaged = useMemo<Extract<
    StagedEmail,
    { source: "current-thread" }
  > | null>(() => {
    if (!currentThread) return null;
    const messageDismissals = new Set<string>();
    const attachmentDismissals = new Set<string>();
    for (const message of currentThread.messages) {
      const entry = emailDismissals.get(message.id);
      if (!entry) continue;
      if (entry.bodyDismissed) {
        messageDismissals.add(message.id);
      }
      for (const attachmentId of entry.attachmentIds) {
        attachmentDismissals.add(attachmentId);
      }
    }
    return {
      key: `current-thread:${currentThread.conversationId}`,
      source: "current-thread",
      thread: currentThread,
      dismissedMessageIds: messageDismissals,
      dismissedAttachmentIds: attachmentDismissals,
    };
  }, [currentThread, emailDismissals]);

  const stagedEmails = useMemo<StagedEmail[]>(() => {
    const list: StagedEmail[] = [];

    if (threadStaged) {
      list.push(threadStaged);
    }

    for (const entry of droppedEmails) {
      const dismissals = emailDismissals.get(entry.key);
      list.push({
        key: entry.key,
        source: "drop",
        parsed: entry.parsed,
        bodyDismissed: dismissals?.bodyDismissed ?? false,
        dismissedAttachmentIds: dismissals?.attachmentIds ?? new Set<string>(),
      });
    }

    return list;
  }, [droppedEmails, emailDismissals, threadStaged]);

  const includedThreadMessages = useMemo<ThreadMessage[]>(() => {
    if (!currentThread || !threadStaged) return [];
    return currentThread.messages.filter(
      (message) => !threadStaged.dismissedMessageIds.has(message.id),
    );
  }, [currentThread, threadStaged]);

  // Everything `buildThreadEmlFile` needs, bundled into one object so the
  // thread and its dismissal state always travel together (never a new thread
  // paired with stale dismissals). New identity whenever the conversation or a
  // checkbox changes; null in compose mode / before a thread loads.
  const threadSynthInput = useMemo(() => {
    if (!currentThread || !threadStaged) return null;
    return {
      thread: currentThread,
      includedMessages: includedThreadMessages,
      dismissedAttachmentIds: threadStaged.dismissedAttachmentIds,
    };
  }, [currentThread, includedThreadMessages, threadStaged]);

  // The full base64 synthesis is genuinely expensive on large threads (tens of
  // MB of attachments → a ~1-2s synchronous encode). Running it directly in a
  // render-phase useMemo would freeze the checkbox the user just clicked. So we
  // synthesize from a DEFERRED copy of the input: the urgent render (checkbox
  // tick, body-dismiss state) commits instantly, and React reruns the heavy
  // memo against the latest input in a follow-up, non-blocking pass.
  //
  // `threadEmlFile` is still the single source of truth — the exact bytes we
  // upload — reused for BOTH the token estimate (as a virtual file) and the
  // actual send, so the estimate measures byte-for-byte what is sent. It only
  // lags the live selection by the deferred pass; see `isThreadEmlStale`.
  // Null when every message is dismissed.
  const deferredSynthInput = useDeferredValue(threadSynthInput);
  const threadEmlFile = useMemo<File | null>(() => {
    if (!deferredSynthInput) return null;
    return buildThreadEmlFile(
      deferredSynthInput.thread,
      deferredSynthInput.includedMessages,
      deferredSynthInput.dismissedAttachmentIds,
    );
  }, [deferredSynthInput]);

  // True while the deferred synthesis is catching up to the latest toggle: the
  // urgent UI has committed but `threadEmlFile` still reflects the previous
  // input. Drives an "Updating…" hint so a large-thread re-encode reads as
  // "recalculating", not a frozen click.
  const isThreadEmlStale = threadSynthInput !== deferredSynthInput;

  const currentStagedDrop = stagedEmails.find(
    (staged): staged is Extract<StagedEmail, { source: "drop" }> =>
      staged.source === "drop",
  );
  const isEmailBodyDismissed = currentThread
    ? includedThreadMessages.length === 0
    : (currentStagedDrop?.bodyDismissed ?? false);
  const emailBodyFile = currentThread
    ? threadEmlFile
    : (currentStagedDrop?.parsed.rawEmlFile ?? null);
  const isEmailBodyIncluded = !!emailBodyFile && !isEmailBodyDismissed;

  const selectableAttachments = useMemo(() => {
    return attachments.filter((attachment) => !attachment.isInline);
  }, [attachments]);

  const selectedAttachmentItems = useMemo<LocalFilePreviewItem[]>(() => {
    return selectableAttachments
      .filter((attachment) => !dismissedAttachmentIds.includes(attachment.id))
      .map((attachment) => ({
        id: attachment.id,
        filename: attachment.name,
        size: attachment.size,
      }));
  }, [dismissedAttachmentIds, selectableAttachments]);

  const dismissStagedEmailBody = useCallback((key: string) => {
    setEmailDismissals((previous) => applyDismissBody(previous, key));
  }, []);

  const restoreStagedEmailBody = useCallback((key: string) => {
    setEmailDismissals((previous) => applyRestoreBody(previous, key));
  }, []);

  const dismissStagedEmailAttachment = useCallback(
    (key: string, attachmentId: string) => {
      setEmailDismissals((previous) =>
        applyDismissAttachment(previous, key, attachmentId),
      );
    },
    [],
  );

  const restoreStagedEmailAttachment = useCallback(
    (key: string, attachmentId: string) => {
      setEmailDismissals((previous) =>
        applyRestoreAttachment(previous, key, attachmentId),
      );
    },
    [],
  );

  // The dedup check has to be StrictMode-safe: returning a synchronous
  // "did we accept this?" answer from inside the setState updater would
  // misreport on the second invocation. Track known keys in a ref so the
  // decision lives outside the updater entirely. The setState updater
  // remains idempotent — re-running it sees the entry already present and
  // returns `previous` unchanged.
  const droppedKeysRef = useRef<Set<string>>(new Set());

  const addDroppedEmail = useCallback((parsed: ParsedEmail): string | null => {
    const key = parsed.messageId ?? generateDroppedKey();
    if (droppedKeysRef.current.has(key)) return null;
    droppedKeysRef.current.add(key);
    setDroppedEmails((previous) =>
      previous.some((entry) => entry.key === key)
        ? previous
        : [...previous, { key, parsed }],
    );
    return key;
  }, []);

  const removeDroppedEmail = useCallback((key: string) => {
    droppedKeysRef.current.delete(key);
    setDroppedEmails((previous) =>
      previous.filter((entry) => entry.key !== key),
    );
    setEmailDismissals((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }, []);

  // Drop-only back-compat helpers. Their scope is intentionally narrow:
  //   - `removeEmailBody` / `restoreEmailBody` only affect the most recent
  //     drop; in thread mode the per-message checkboxes drive dismissal.
  //   - `removeAttachment` / `restoreAttachment` only affect Office.js
  //     compose-mode attachments (the fallback group rendered when there
  //     is neither a thread nor a drop).
  // Kept under the legacy names to avoid breaking the existing
  // `handleRemoveEmailSourceFile` wiring inside `AddinChatInput`. If a
  // future caller wants "remove the current email", reach for
  // `dismissStagedEmailBody(messageId)` directly — these are silent
  // no-ops outside their narrow scope.
  const removeEmailBody = useCallback(() => {
    if (!currentStagedDrop) return;
    dismissStagedEmailBody(currentStagedDrop.key);
  }, [currentStagedDrop, dismissStagedEmailBody]);

  const restoreEmailBody = useCallback(() => {
    if (!currentStagedDrop) return;
    restoreStagedEmailBody(currentStagedDrop.key);
  }, [currentStagedDrop, restoreStagedEmailBody]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.includes(attachmentId) ? previous : [...previous, attachmentId],
    );
  }, []);

  const restoreAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.filter((id) => id !== attachmentId),
    );
  }, []);

  const resolveSelectedFilesForSend = useCallback(async (): Promise<File[]> => {
    const filesToSend: File[] = [];

    // Thread upload: reuse the exact File already built for the estimate, so
    // what we upload is byte-identical to what the token estimate measured.
    // It carries every non-dismissed message + their non-dismissed attachments
    // as nested message/rfc822 parts, preserving version provenance — three
    // files named "Lastenheft.pdf" land inside three different nested parts.
    if (threadEmlFile) {
      filesToSend.push(threadEmlFile);
    }

    // Drop uploads: keep the existing per-drop trim path. Each drop is
    // independent of the open thread.
    for (const staged of stagedEmails) {
      if (staged.source !== "drop") continue;
      if (staged.bodyDismissed) continue;
      const indicesToRemove = collectDismissedIndices(
        staged.parsed.attachments,
        staged.dismissedAttachmentIds,
      );
      if (indicesToRemove.length === 0) {
        filesToSend.push(staged.parsed.rawEmlFile);
        continue;
      }
      const trimmed = await trimRawEmlBytes(
        staged.parsed.rawEmlFile,
        indicesToRemove,
      );
      filesToSend.push(trimmed);
    }

    // Office.js compose-mode fallback. Only invoked when there is no thread
    // and no drops — in read mode the thread .eml already carries the
    // attachments, in drop-only mode the drop .eml does. Cloud attachments
    // skipped here because their content can't be resolved locally.
    if (!currentThread && stagedEmails.every((s) => s.source !== "drop")) {
      const remainingAttachments = selectableAttachments.filter(
        (attachment) => !dismissedAttachmentIds.includes(attachment.id),
      );
      for (const attachment of remainingAttachments) {
        if (
          String(attachment.attachmentType).toLowerCase() ===
          OUTLOOK_CLOUD_ATTACHMENT_TYPE
        ) {
          console.warn(
            "Skipping Outlook cloud attachment because file content cannot be resolved locally:",
            attachment.name,
          );
          continue;
        }
        try {
          const file = await getAttachmentFile(attachment.id);
          filesToSend.push(file);
        } catch (error) {
          console.warn(
            `Failed to resolve Outlook attachment "${attachment.name}" for send:`,
            error,
          );
        }
      }
    }

    return filesToSend;
  }, [
    currentThread,
    dismissedAttachmentIds,
    getAttachmentFile,
    selectableAttachments,
    stagedEmails,
    threadEmlFile,
  ]);

  const value = useMemo<OutlookEmailSourceContextValue>(
    () => ({
      emailSubject: mailItem?.subject ?? "",
      isEmailBodyIncluded,
      emailBodyFile,
      isThreadEmlStale,
      isLoadingEmailBody,
      emailThreadLoadError,
      currentThread,
      stagedEmails,
      dismissStagedEmailBody,
      restoreStagedEmailBody,
      dismissStagedEmailAttachment,
      restoreStagedEmailAttachment,
      addDroppedEmail,
      removeDroppedEmail,
      selectedAttachmentItems,
      isLoadingAttachments,
      removeEmailBody,
      removeAttachment,
      restoreEmailBody,
      restoreAttachment,
      isEmailBodyDismissed,
      dismissedAttachmentIds,
      resolveSelectedFilesForSend,
      hasSelectedEmailSource:
        stagedEmails.length > 0 ||
        isEmailBodyIncluded ||
        selectedAttachmentItems.length > 0,
      parentReplyContext,
      isLoadingParentReplyContext,
    }),
    [
      addDroppedEmail,
      currentThread,
      dismissStagedEmailAttachment,
      dismissStagedEmailBody,
      dismissedAttachmentIds,
      emailBodyFile,
      isThreadEmlStale,
      isEmailBodyDismissed,
      emailThreadLoadError,
      isEmailBodyIncluded,
      isLoadingAttachments,
      isLoadingEmailBody,
      isLoadingParentReplyContext,
      mailItem?.subject,
      parentReplyContext,
      removeAttachment,
      removeDroppedEmail,
      removeEmailBody,
      resolveSelectedFilesForSend,
      restoreAttachment,
      restoreEmailBody,
      restoreStagedEmailAttachment,
      restoreStagedEmailBody,
      selectedAttachmentItems,
      stagedEmails,
    ],
  );

  return (
    <OutlookEmailSourceContext.Provider value={value}>
      {children}
    </OutlookEmailSourceContext.Provider>
  );
}
