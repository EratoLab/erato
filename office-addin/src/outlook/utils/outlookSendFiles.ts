import type { OutlookThreadChoice } from "../hooks/outlookContextStore";
import type { ResolvedPart } from "../providers/OutlookEmailSourceProvider";

export interface OutlookFilePlanThreadInput {
  /** "none": no thread for this item (compose, appointment, no conversation or no mail backend). */
  status: "none" | "loading" | "error" | "ready";
  /** Graph needs an interactive step before the thread can load; only with "error". */
  signIn: "sign-in" | "consent" | null;
  /** Messages of the loaded thread and how many are ticked. */
  messageCount: number;
  includedMessageCount: number;
  /** The `.eml` the send would upload; null before it is first built or when nothing is ticked. */
  file: File | null;
  /** `file` still reflects the ticks before the latest one. */
  stale: boolean;
  /** The key `resolvedParts` uses for the thread. */
  partKey: string | null;
  /** A dismissal inside a forwarded email cannot be cut out of its bytes. */
  trimError: boolean;
  conversationId: string | null;
  choice: OutlookThreadChoice;
  /** The thread went with an earlier message of this conversation. */
  sentInChat: boolean;
  /** The open email itself is staged as a drop, or being read as one. */
  stagedAsDrop: boolean;
}

export interface OutlookFilePlanAttachmentInput {
  id: string;
  /** A link to a cloud file, which Outlook cannot hand over. */
  cloud: boolean;
  /** The user's tick in the chip or its detail. */
  ticked: boolean;
}

export interface OutlookFilePlanInput {
  /** No message has been sent in this chat yet. */
  freshChat: boolean;
  thread: OutlookFilePlanThreadInput;
  attachments: {
    /** "compose": the draft's own; "read": the open email's, sent only without a thread. */
    mode: "compose" | "read";
    items: readonly OutlookFilePlanAttachmentInput[];
    /** Office.js is still reporting them. */
    loading: boolean;
    groupOff: boolean;
    includeOnFollowUpIds: ReadonlySet<string>;
    sentIds: ReadonlySet<string>;
  };
  /** Every staged drop in drop order, with its resolution once there is one. */
  drops: readonly {
    key: string;
    file: File | null;
    size: number;
    error: boolean;
  }[];
  /** The drops' files still reflect the ticks before the latest one. */
  dropsStale: boolean;
}

export type OutlookThreadDisposition =
  | { kind: "none" }
  | { kind: "hidden"; why: "sent-in-chat" | "dropped" }
  | { kind: "loading" }
  | { kind: "error"; why: "load" | "trim" }
  | { kind: "sign-in"; consent: boolean }
  | { kind: "off"; retry: boolean }
  | { kind: "follow-up"; retry: boolean }
  | { kind: "nothing" }
  | { kind: "sent"; included: number; total: number };

export type OutlookAttachmentDisposition =
  | "sent"
  | "off"
  | "sent-earlier"
  | "follow-up"
  | "cloud"
  | "not-with-drops";

export interface OutlookFilePlan {
  thread: OutlookThreadDisposition;
  /** Office.js attachments the chips show, in order; empty when none are shown. */
  attachments: { id: string; disposition: OutlookAttachmentDisposition }[];
  drops: { key: string; state: "sent" | "error" }[];
  uploadThread: boolean;
  composeAttachmentIds: string[];
  /** The `.eml` parts the send uploads, for the size and count check. */
  parts: ResolvedPart[];
  /** The send has something to upload, so it takes the upload path. */
  uploads: boolean;
  /**
   * The thread would go but its file is not ready: it is loading, or the
   * `.eml` is not built for the latest ticks yet. The composer waits.
   */
  waitingForThread: boolean;
  /** A drop's file is rebuilding after a tick; the composer waits. */
  waitingForDrops: boolean;
}

function threadDisposition(
  freshChat: boolean,
  thread: OutlookFilePlanThreadInput,
): OutlookThreadDisposition {
  const { status, choice } = thread;
  if (status === "none") return { kind: "none" };
  if (thread.stagedAsDrop) return { kind: "hidden", why: "dropped" };
  // A fresh chat has sent nothing, whatever a send that never arrived recorded.
  if (!freshChat && thread.sentInChat && choice !== "included") {
    return { kind: "hidden", why: "sent-in-chat" };
  }
  // A follow-up never sends the open email unasked, so neither its loading
  // nor its failure is the user's concern until they include it.
  if (!freshChat && choice === null) {
    return { kind: "follow-up", retry: status === "error" };
  }
  if (status === "loading" && choice !== "excluded") return { kind: "loading" };
  if (status === "error" && choice !== "excluded") {
    return thread.signIn
      ? { kind: "sign-in", consent: thread.signIn === "consent" }
      : { kind: "error", why: "load" };
  }
  if (choice === "excluded") {
    return { kind: "off", retry: status === "error" };
  }
  if (thread.includedMessageCount === 0) return { kind: "nothing" };
  if (thread.trimError) return { kind: "error", why: "trim" };
  return {
    kind: "sent",
    included: thread.includedMessageCount,
    total: thread.messageCount,
  };
}

/** Read mode sends the open email's attachments only where no thread carries them. */
function showsAttachments(input: OutlookFilePlanInput): boolean {
  const { attachments, thread } = input;
  if (attachments.loading || attachments.items.length === 0) return false;
  if (attachments.mode === "compose") return true;
  return thread.status === "none" || thread.status === "error";
}

function attachmentDisposition(
  input: OutlookFilePlanInput,
  item: OutlookFilePlanAttachmentInput,
  dropStaged: boolean,
): OutlookAttachmentDisposition {
  const { attachments, freshChat } = input;
  // An unticked cloud file is off like any other, so its chip offers (+).
  if (!item.ticked) return "off";
  if (item.cloud) return "cloud";
  if (attachments.groupOff) return "off";
  if (!freshChat && attachments.sentIds.has(item.id)) return "sent-earlier";
  if (dropStaged) return "not-with-drops";
  if (!freshChat && !attachments.includeOnFollowUpIds.has(item.id)) {
    return "follow-up";
  }
  return "sent";
}

/**
 * Which files the next send uploads, one decision per file: the open thread,
 * each Office.js attachment, each drop. The chips render this plan and the
 * send uploads exactly it, so a chip never says "included" for a file that
 * stays behind.
 */
export function planOutlookFiles(input: OutlookFilePlanInput): OutlookFilePlan {
  const thread = threadDisposition(input.freshChat, input.thread);
  const dropStaged = input.drops.length > 0;
  const attachments = showsAttachments(input)
    ? input.attachments.items.map((item) => ({
        id: item.id,
        disposition: attachmentDisposition(input, item, dropStaged),
      }))
    : [];
  const drops = input.drops.map((drop) => ({
    key: drop.key,
    state: drop.error ? ("error" as const) : ("sent" as const),
  }));
  const uploadThread = thread.kind === "sent";
  // Without a current file the send would upload nothing, or the bytes of
  // the ticks before the last one.
  const threadFileNotReady =
    uploadThread && (input.thread.file === null || input.thread.stale);
  const composeAttachmentIds = attachments
    .filter((attachment) => attachment.disposition === "sent")
    .map((attachment) => attachment.id);
  const parts: ResolvedPart[] = [];
  if (uploadThread && input.thread.file && input.thread.partKey) {
    parts.push({
      key: input.thread.partKey,
      name: input.thread.file.name,
      size: input.thread.file.size,
    });
  }
  for (const drop of input.drops) {
    if (drop.file) {
      parts.push({ key: drop.key, name: drop.file.name, size: drop.size });
    }
  }
  return {
    thread,
    attachments,
    drops,
    uploadThread,
    composeAttachmentIds,
    parts,
    uploads: uploadThread || dropStaged || composeAttachmentIds.length > 0,
    waitingForThread: thread.kind === "loading" || threadFileNotReady,
    waitingForDrops: dropStaged && input.dropsStale,
  };
}
