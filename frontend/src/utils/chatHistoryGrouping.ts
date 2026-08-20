/**
 * Client-side bucketing of the sidebar's recent-chat sessions for the
 * "Group by" filter, plus the shared classifier behind both the row status
 * dot and the "Unread" bucket.
 */
import { t } from "@lingui/core/macro";

import type { ChatHistoryGroupBy } from "@/hooks/chat/store/chatHistoryFilterStore";
import type { ChatGenerationStatus } from "@/hooks/chat/store/generationStatusStore";
import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

/** Kinds a chat row's status indicator can show. */
export type ChatAttentionStatus = Exclude<
  ChatGenerationStatus["kind"],
  "cleared"
>;

/**
 * Resolves a row's status indicator; an unresolved tool confirmation outranks
 * the generation state.
 */
export function resolveChatAttentionStatus(
  status: ChatGenerationStatus | undefined,
  hasPendingConfirmation: boolean,
): ChatAttentionStatus | null {
  if (hasPendingConfirmation) return "action_required";
  if (!status || status.kind === "cleared") return null;
  return status.kind;
}

export function chatAttentionStatusLabel(status: ChatAttentionStatus): string {
  switch (status) {
    case "running":
      return t({ id: "chat.history.generation.running", message: "Running" });
    case "finished":
      return t({ id: "chat.history.generation.finished", message: "Finished" });
    case "error":
      return t({ id: "chat.history.generation.error", message: "Error" });
    case "action_required":
      return t({
        id: "chat.history.generation.actionRequired",
        message: "Action required",
      });
  }
}

export const chatAttentionStatusToneClass: Record<ChatAttentionStatus, string> =
  {
    running: "text-theme-fg-muted",
    finished: "text-theme-success-fg",
    error: "text-theme-error-fg",
    action_required: "text-theme-warning-fg",
  };

/** `delegated_run_outcome` of a run that landed a clean assistant answer. */
const RUN_OUTCOME_COMPLETED = "completed";
/** `delegated_run_outcome` of a run that did not. */
const RUN_OUTCOME_FAILED = "failed";

/**
 * A delegated run row's status indicator. The status store is the live
 * authority (seeded from the listing and kept fresh by the poll), so a
 * running or parked entry outranks the listing's terminal outcome — a chat
 * can be generating again after adoption while its outcome already exists.
 * This is a status column, not an unread marker: a "cleared" tombstone
 * (outcome consumed, e.g. by opening the run) keeps saying the consumed
 * outcome here, exactly what the refetched listing's durable outcome will
 * say after a reload — while still blocking the stale listing markers and
 * the pending fallback from resurrecting a live state. A tombstone that
 * consumed no outcome (a decided approval, an entry that went unknown)
 * shows nothing. A row with no signal at all is a run between dispatch and
 * its generation lease, which is live, not broken.
 */
export function resolveDelegatedRunStatus(
  chat: Pick<
    RecentChat,
    | "delegated_run_outcome"
    | "active_generation_started_at"
    | "pending_tool_approval_at"
  >,
  storeStatus: ChatGenerationStatus | undefined,
): ChatAttentionStatus | null {
  if (
    storeStatus?.kind === "running" ||
    storeStatus?.kind === "action_required"
  ) {
    return storeStatus.kind;
  }
  if (chat.delegated_run_outcome === RUN_OUTCOME_COMPLETED) return "finished";
  if (chat.delegated_run_outcome === RUN_OUTCOME_FAILED) return "error";
  if (storeStatus?.kind === "finished" || storeStatus?.kind === "error") {
    return storeStatus.kind;
  }
  if (storeStatus?.kind === "cleared") return storeStatus.consumed ?? null;
  if (chat.pending_tool_approval_at) return "action_required";
  return "running";
}

/**
 * Rank used when one indicator has to stand in for a set of chats: the most
 * demanding status wins, and a still-running one is the least demanding.
 */
const ATTENTION_PRIORITY: ChatAttentionStatus[] = [
  "action_required",
  "error",
  "finished",
  "running",
];

export function mostUrgentAttentionStatus(
  statuses: Iterable<ChatAttentionStatus>,
): ChatAttentionStatus | null {
  const present = new Set(statuses);
  return ATTENTION_PRIORITY.find((status) => present.has(status)) ?? null;
}

export interface ChatSessionGroup {
  key: string;
  /** `null` renders the bucket without a header. */
  label: string | null;
  sessions: ChatSession[];
}

export interface GroupChatSessionsDeps {
  /** Reference time for the calendar-day buckets. */
  now: Date;
  /** BCP 47 tag for the localized day labels. */
  locale: string;
  /** Whether the session's row currently shows a status indicator. */
  needsAttention: (session: ChatSession) => boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Most-recent calendar days that get their own dated bucket. */
const DATED_BUCKET_DAYS = 7;

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const groupSessionsByDay = (
  sessions: ChatSession[],
  now: Date,
  locale: string,
): ChatSessionGroup[] => {
  const dayFormat = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  const nowStart = startOfDay(now);
  const dated: ChatSessionGroup[] = [];
  const datedByKey = new Map<string, ChatSessionGroup>();
  const older: ChatSession[] = [];

  for (const session of sessions) {
    const date = new Date(session.updatedAt);
    if (Number.isNaN(date.getTime())) {
      older.push(session);
      continue;
    }
    const dayStart = startOfDay(date);
    // Rounding absorbs the off-by-an-hour day lengths around DST changes.
    const dayAge = Math.round((nowStart - dayStart) / MS_PER_DAY);
    if (dayAge >= DATED_BUCKET_DAYS) {
      older.push(session);
      continue;
    }
    const key = `day-${dayStart}`;
    let group = datedByKey.get(key);
    if (!group) {
      group = { key, label: dayFormat.format(date), sessions: [] };
      datedByKey.set(key, group);
      dated.push(group);
    }
    group.sessions.push(session);
  }

  if (older.length === 0) {
    return dated;
  }
  return [
    ...dated,
    {
      key: "older",
      label: t({ id: "chat.history.group.older", message: "Older" }),
      sessions: older,
    },
  ];
};

const partitionedGroups = (
  sessions: ChatSession[],
  buckets: {
    key: string;
    label: string;
    matches: (session: ChatSession) => boolean;
  }[],
): ChatSessionGroup[] => {
  const groups = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    sessions: sessions.filter(bucket.matches),
  }));
  return groups.filter((group) => group.sessions.length > 0);
};

/**
 * Buckets `sessions` (already sorted newest-first) for the sidebar's Recent
 * section. Empty buckets are omitted; an empty input yields no groups.
 */
export function groupChatSessions(
  sessions: ChatSession[],
  groupBy: ChatHistoryGroupBy,
  deps: GroupChatSessionsDeps,
): ChatSessionGroup[] {
  if (sessions.length === 0) {
    return [];
  }
  switch (groupBy) {
    case "date":
      return groupSessionsByDay(sessions, deps.now, deps.locale);
    case "type":
      return partitionedGroups(sessions, [
        {
          key: "chats",
          label: t({ id: "chat.history.group.chats", message: "Chats" }),
          matches: (session) => !session.assistantId,
        },
        {
          key: "assistants",
          label: t({
            id: "chat.history.group.assistants",
            message: "Assistants",
          }),
          matches: (session) => Boolean(session.assistantId),
        },
      ]);
    case "unread":
      return partitionedGroups(sessions, [
        {
          key: "unread",
          label: t({ id: "chat.history.group.unread", message: "Unread" }),
          matches: deps.needsAttention,
        },
        {
          key: "other",
          label: t({ id: "chat.history.group.other", message: "Other" }),
          matches: (session) => !deps.needsAttention(session),
        },
      ]);
    case "none":
    default:
      // `groupBy` is rehydrated from user-editable storage, so an out-of-union
      // value can still arrive here and must degrade to the ungrouped view.
      return [{ key: "all", label: null, sessions }];
  }
}
