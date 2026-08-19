/**
 * Client-side bucketing of the sidebar's recent-chat sessions for the
 * "Group by" filter, plus the shared classifier behind both the row status
 * dot and the "Unread" bucket.
 */
import { t } from "@lingui/core/macro";

import type { ChatHistoryGroupBy } from "@/hooks/chat/store/chatHistoryFilterStore";
import type { ChatGenerationStatus } from "@/hooks/chat/store/generationStatusStore";
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
