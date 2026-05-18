import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useMsalNaa } from "./MsalNaaProvider";
import { useOutlookMailItem } from "./OutlookMailItemProvider";
import { fetchCurrentEmailParsed } from "../utils/fetchCurrentEmailEml";
import { fetchParentMessageInConversationViaGraph } from "../utils/fetchOutlookMessageGraph";
import {
  dismissAttachment as applyDismissAttachment,
  dismissBody as applyDismissBody,
  restoreAttachment as applyRestoreAttachment,
  restoreBody as applyRestoreBody,
} from "../utils/stagedEmailDismissals";

import type { ParentMessageMetadata } from "../utils/fetchOutlookMessageGraph";
import type { ParsedEmail } from "../utils/parsedEmail";
import type { StagedEmailDismissalsMap } from "../utils/stagedEmailDismissals";
import type { LocalFilePreviewItem } from "@erato/frontend/library";
import type { ReactNode } from "react";

const OUTLOOK_CLOUD_ATTACHMENT_TYPE = "cloud";
const GRAPH_MAIL_SCOPES = ["Mail.Read"];
const CURRENT_EMAIL_FALLBACK_KEY = "current-email";

let droppedKeyCounter = 0;
function generateDroppedKey(): string {
  droppedKeyCounter += 1;
  return `drop-${Date.now()}-${droppedKeyCounter}`;
}

export type StagedEmailSource = "current" | "drop";

export interface StagedEmail {
  /** Stable across renders; equal to RFC 5322 Message-ID when available. */
  key: string;
  source: StagedEmailSource;
  parsed: ParsedEmail;
  bodyDismissed: boolean;
  dismissedAttachmentIds: ReadonlySet<string>;
}

interface DroppedEmailEntry {
  key: string;
  parsed: ParsedEmail;
}

interface OutlookEmailSourceContextValue {
  emailSubject: string;
  isEmailBodyIncluded: boolean;
  emailBodyFile: File | null;
  isLoadingEmailBody: boolean;
  /**
   * Structured view of the currently-open email when fetched via Graph
   * (read mode only). Powers the per-attachment selection UI and will feed
   * surgical MIME removal in Phase 2. `null` when the email body comes from
   * the synthesized-HTML compose-mode path or before Graph returns.
   */
  currentEmailParsed: ParsedEmail | null;
  /**
   * Unified list of emails staged for upload, currently-open and dropped
   * alike. Drives the grouped-card UI for selection. Updates to dismissal
   * state are applied via `dismissStagedEmailBody` and
   * `dismissStagedEmailAttachment` (and their restore counterparts).
   *
   * Phase 1: the selection state captured here drives the UI only — the
   * upload payload for the currently-open email path is still the raw
   * `.eml`. Phase 2 wires surgical MIME removal so deselected attachments
   * are stripped from the bytes before upload.
   */
  stagedEmails: StagedEmail[];
  dismissStagedEmailBody: (key: string) => void;
  restoreStagedEmailBody: (key: string) => void;
  dismissStagedEmailAttachment: (key: string, attachmentId: string) => void;
  restoreStagedEmailAttachment: (key: string, attachmentId: string) => void;
  /**
   * Add a parsed email (from a drop or an OWA mail-list drag) to the
   * staged list. Returns the stable key under which it was filed so
   * callers can reference it later (e.g. to remove it). Returns `null`
   * when the email is already staged under the same Message-ID.
   */
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
  /**
   * Metadata of the most recent non-draft message in the same conversation
   * thread, when the user is in Outlook compose mode replying / forwarding.
   * Display-only — surfaces a "Reply context" chip in the chat input UI.
   * Not part of `resolveSelectedFilesForSend`: the body is already in the
   * draft via Outlook's auto-quote and reaches the LLM through the
   * `outlook_review_draft.full_body` action facet, so re-sending it here
   * would double the token cost.
   */
  parentReplyContext: ParentMessageMetadata | null;
  isLoadingParentReplyContext: boolean;
}

const defaultValue: OutlookEmailSourceContextValue = {
  emailSubject: "",
  isEmailBodyIncluded: false,
  emailBodyFile: null,
  isLoadingEmailBody: false,
  currentEmailParsed: null,
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
  const { acquireToken } = useMsalNaa();
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<
    string[]
  >([]);
  const [currentEmailParsed, setCurrentEmailParsed] = useState<ParsedEmail | null>(
    null,
  );
  const [isLoadingEmailBody, setIsLoadingEmailBody] = useState(false);
  const [parentReplyContext, setParentReplyContext] =
    useState<ParentMessageMetadata | null>(null);
  const [isLoadingParentReplyContext, setIsLoadingParentReplyContext] =
    useState(false);
  const [emailDismissals, setEmailDismissals] =
    useState<StagedEmailDismissalsMap>(() => new Map());
  const [droppedEmails, setDroppedEmails] = useState<DroppedEmailEntry[]>([]);

  const acquireGraphToken = useCallback(
    () => acquireToken(GRAPH_MAIL_SCOPES),
    [acquireToken],
  );

  const itemId = mailItem?.itemId ?? null;
  const conversationId = mailItem?.conversationId ?? null;
  const isComposeMode = mailItem?.isComposeMode ?? false;

  // Fetch and parse the raw `.eml` via Graph whenever the open email changes.
  // Drafts and compose items have no itemId, so no accessory is produced —
  // matches the Graph indexing contract (`/$value` 404s on unsent messages).
  useEffect(() => {
    if (!itemId) {
      setCurrentEmailParsed(null);
      setIsLoadingEmailBody(false);
      return;
    }

    let cancelled = false;
    setIsLoadingEmailBody(true);
    setCurrentEmailParsed(null);

    void fetchCurrentEmailParsed(itemId, acquireGraphToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setCurrentEmailParsed(result?.parsed ?? null);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoadingEmailBody(false);
      });

    return () => {
      cancelled = true;
    };
  }, [acquireGraphToken, itemId]);

  // Fetch the parent-thread metadata when the user is composing a reply or
  // forward. Graph's `/me/messages/{itemId}` 404s on drafts (the very issue
  // that gates the read-mode preview above), but the *parent* message is
  // indexed and addressable by `conversationId`. We surface a display-only
  // "Reply context" chip; the body itself reaches the LLM via the auto-quote
  // already embedded in the draft, so re-fetching it here is unnecessary.
  useEffect(() => {
    if (!isComposeMode || !conversationId || itemId) {
      setParentReplyContext(null);
      setIsLoadingParentReplyContext(false);
      return;
    }

    let cancelled = false;
    setIsLoadingParentReplyContext(true);
    setParentReplyContext(null);

    void fetchParentMessageInConversationViaGraph(
      conversationId,
      acquireGraphToken,
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setParentReplyContext(result);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsLoadingParentReplyContext(false);
      });

    return () => {
      cancelled = true;
    };
  }, [acquireGraphToken, conversationId, isComposeMode, itemId]);

  // Clear dismissals when the host mail item changes. Office.js attachment
  // ids are per-item — so the dismissal set from a previous message would
  // otherwise leak into the new one. Staged-email dismissals (`emailDismissals`)
  // are keyed by RFC 5322 Message-ID, which is globally unique, so they don't
  // need this scope-flush.
  useEffect(() => {
    setDismissedAttachmentIds([]);
  }, [itemIdentity]);

  const currentEmailKey =
    currentEmailParsed?.messageId ?? CURRENT_EMAIL_FALLBACK_KEY;

  const stagedEmails = useMemo<StagedEmail[]>(() => {
    const list: StagedEmail[] = [];

    if (currentEmailParsed) {
      const dismissals = emailDismissals.get(currentEmailKey);
      list.push({
        key: currentEmailKey,
        source: "current",
        parsed: currentEmailParsed,
        bodyDismissed: dismissals?.bodyDismissed ?? false,
        dismissedAttachmentIds:
          dismissals?.attachmentIds ?? new Set<string>(),
      });
    }

    for (const entry of droppedEmails) {
      const dismissals = emailDismissals.get(entry.key);
      list.push({
        key: entry.key,
        source: "drop",
        parsed: entry.parsed,
        bodyDismissed: dismissals?.bodyDismissed ?? false,
        dismissedAttachmentIds:
          dismissals?.attachmentIds ?? new Set<string>(),
      });
    }

    return list;
  }, [currentEmailKey, currentEmailParsed, droppedEmails, emailDismissals]);

  const currentStagedEmail = stagedEmails[0] ?? null;
  const isEmailBodyDismissed = currentStagedEmail?.bodyDismissed ?? false;
  const emailBodyFile = currentEmailParsed?.rawEmlFile ?? null;
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

  const addDroppedEmail = useCallback((parsed: ParsedEmail): string | null => {
    const key = parsed.messageId ?? generateDroppedKey();
    let assigned: string | null = key;
    setDroppedEmails((previous) => {
      if (previous.some((entry) => entry.key === key)) {
        assigned = null;
        return previous;
      }
      return [...previous, { key, parsed }];
    });
    return assigned;
  }, []);

  const removeDroppedEmail = useCallback((key: string) => {
    setDroppedEmails((previous) => previous.filter((entry) => entry.key !== key));
    setEmailDismissals((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }, []);

  const removeEmailBody = useCallback(() => {
    if (!currentStagedEmail) return;
    dismissStagedEmailBody(currentStagedEmail.key);
  }, [currentStagedEmail, dismissStagedEmailBody]);

  const restoreEmailBody = useCallback(() => {
    if (!currentStagedEmail) return;
    restoreStagedEmailBody(currentStagedEmail.key);
  }, [currentStagedEmail, restoreStagedEmailBody]);

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

    for (const staged of stagedEmails) {
      if (!staged.bodyDismissed) {
        filesToSend.push(staged.parsed.rawEmlFile);
      }
      // Phase 1 transitional sibling-upload for dropped emails. Phase 2
      // surgical MIME removal will replace this branch — at that point
      // deselected attachments are trimmed from the bytes and we ship a
      // single `.eml` per staged email. For current-email reads we leave
      // the .eml whole; in-eml attachment dismissals there are UX-only
      // until Phase 2.
      if (staged.source !== "drop") {
        continue;
      }
      for (const attachment of staged.parsed.attachments) {
        if (attachment.disposition === "inline" || attachment.related) {
          continue;
        }
        if (staged.dismissedAttachmentIds.has(attachment.id)) {
          continue;
        }
        filesToSend.push(attachment.toFile());
      }
    }

    // Office.js compose-mode attachments. When a current-email `.eml` is
    // staged (read mode), these are duplicates of the in-eml attachments
    // already inside the `.eml` and we skip them to avoid double-counting.
    const hasReadModeCurrentStaged = stagedEmails.some(
      (staged) => staged.source === "current",
    );
    if (!hasReadModeCurrentStaged) {
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
    dismissedAttachmentIds,
    getAttachmentFile,
    selectableAttachments,
    stagedEmails,
  ]);

  const value = useMemo<OutlookEmailSourceContextValue>(
    () => ({
      emailSubject: mailItem?.subject ?? "",
      isEmailBodyIncluded,
      emailBodyFile,
      isLoadingEmailBody,
      currentEmailParsed,
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
        isEmailBodyIncluded || selectedAttachmentItems.length > 0,
      parentReplyContext,
      isLoadingParentReplyContext,
    }),
    [
      addDroppedEmail,
      currentEmailParsed,
      dismissStagedEmailAttachment,
      dismissStagedEmailBody,
      dismissedAttachmentIds,
      emailBodyFile,
      isEmailBodyDismissed,
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
