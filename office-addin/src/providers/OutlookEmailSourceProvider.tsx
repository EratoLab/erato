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
import { fetchCurrentEmailEml } from "../utils/fetchCurrentEmailEml";
import { fetchParentMessageInConversationViaGraph } from "../utils/fetchOutlookMessageGraph";

import type { ParentMessageMetadata } from "../utils/fetchOutlookMessageGraph";
import type { LocalFilePreviewItem } from "@erato/frontend/library";
import type { ReactNode } from "react";

const OUTLOOK_CLOUD_ATTACHMENT_TYPE = "cloud";
const GRAPH_MAIL_SCOPES = ["Mail.Read"];

interface OutlookEmailSourceContextValue {
  emailSubject: string;
  isEmailBodyIncluded: boolean;
  emailBodyFile: File | null;
  isLoadingEmailBody: boolean;
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
  const [dismissedBodyMailIdentity, setDismissedBodyMailIdentity] = useState<
    string | null
  >(null);
  const [dismissedAttachmentIds, setDismissedAttachmentIds] = useState<
    string[]
  >([]);
  const [emailBodyFile, setEmailBodyFile] = useState<File | null>(null);
  const [isLoadingEmailBody, setIsLoadingEmailBody] = useState(false);
  const [parentReplyContext, setParentReplyContext] =
    useState<ParentMessageMetadata | null>(null);
  const [isLoadingParentReplyContext, setIsLoadingParentReplyContext] =
    useState(false);

  const acquireGraphToken = useCallback(
    () => acquireToken(GRAPH_MAIL_SCOPES),
    [acquireToken],
  );

  const itemId = mailItem?.itemId ?? null;
  const conversationId = mailItem?.conversationId ?? null;
  const isComposeMode = mailItem?.isComposeMode ?? false;

  // Fetch the raw `.eml` via Graph whenever the open email changes. Drafts
  // and compose items have no itemId, so no accessory is produced — matches
  // the Graph indexing contract (`/$value` 404s on unsent messages).
  useEffect(() => {
    if (!itemId) {
      setEmailBodyFile(null);
      setIsLoadingEmailBody(false);
      return;
    }

    let cancelled = false;
    setIsLoadingEmailBody(true);
    setEmailBodyFile(null);

    void fetchCurrentEmailEml(itemId, acquireGraphToken)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setEmailBodyFile(result?.file ?? null);
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

  useEffect(() => {
    if (!itemIdentity) {
      setDismissedBodyMailIdentity(null);
      setDismissedAttachmentIds([]);
      return;
    }

    if (
      dismissedBodyMailIdentity &&
      dismissedBodyMailIdentity !== itemIdentity
    ) {
      setDismissedBodyMailIdentity(null);
      setDismissedAttachmentIds([]);
    }
  }, [dismissedBodyMailIdentity, itemIdentity]);

  const isEmailBodyDismissed =
    !!itemIdentity && dismissedBodyMailIdentity === itemIdentity;

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

  const removeEmailBody = useCallback(() => {
    if (!itemIdentity) {
      return;
    }

    setDismissedBodyMailIdentity(itemIdentity);
  }, [itemIdentity]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.includes(attachmentId) ? previous : [...previous, attachmentId],
    );
  }, []);

  const restoreEmailBody = useCallback(() => {
    setDismissedBodyMailIdentity(null);
  }, []);

  const restoreAttachment = useCallback((attachmentId: string) => {
    setDismissedAttachmentIds((previous) =>
      previous.filter((id) => id !== attachmentId),
    );
  }, []);

  const resolveSelectedFilesForSend = useCallback(async (): Promise<File[]> => {
    const filesToSend: File[] = [];

    if (isEmailBodyIncluded && emailBodyFile) {
      filesToSend.push(emailBodyFile);
    }

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

    return filesToSend;
  }, [
    dismissedAttachmentIds,
    emailBodyFile,
    getAttachmentFile,
    isEmailBodyIncluded,
    selectableAttachments,
  ]);

  const value = useMemo<OutlookEmailSourceContextValue>(
    () => ({
      emailSubject: mailItem?.subject ?? "",
      isEmailBodyIncluded,
      emailBodyFile,
      isLoadingEmailBody,
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
      removeEmailBody,
      resolveSelectedFilesForSend,
      restoreAttachment,
      restoreEmailBody,
      selectedAttachmentItems,
    ],
  );

  return (
    <OutlookEmailSourceContext.Provider value={value}>
      {children}
    </OutlookEmailSourceContext.Provider>
  );
}
