import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  seedGenerationStatusFromListing,
  useGenerationStatusStore,
} from "@/hooks/chat/store/generationStatusStore";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useRecentChats } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";
import { delegatedRunsListingParams } from "@/utils/chat/delegatedRunDispatch";
import {
  isBackgroundRun,
  resolveRecentChatTitle,
} from "@/utils/chat/recentChatSession";
import { getChatUrl } from "@/utils/chat/urlUtils";
import {
  chatAttentionStatusLabel,
  mostUrgentAttentionStatus,
  resolveDelegatedRunStatus,
} from "@/utils/chatHistoryGrouping";

import { ChatAttentionStatusDot } from "./ChatAttentionStatusDot";
import { InteractiveContainer } from "../Container/InteractiveContainer";
import { Button } from "../Controls/Button";
import { Collapse } from "../Controls/Collapse";
import { MessageTimestamp } from "../Message/MessageTimestamp";
import { OpenNewWindowIcon, CheckIcon, ChevronRightIcon } from "../icons";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Checked-off runs, deliberately per-device: a run's outcome is a property
 * of the chat and no per-user seen-state exists server-side, so a dismissal
 * recorded here does not follow the user to their other devices.
 */
const DISMISSED_DELEGATED_RUNS_STORAGE_KEY =
  "erato.chat.dismissedDelegatedRuns";

/**
 * Delegated runs stay listable forever, so the set only grows. The cap
 * bounds it by shedding the oldest dismissals — worst case a long-forgotten
 * run reappears in its origin chat's section and can be checked off again.
 */
const DISMISSED_RUNS_LIMIT = 500;

/** Stable fallback: `useSyncExternalStore` needs a referentially constant
 * snapshot for the unset case. */
const NO_DISMISSED_RUN_IDS: readonly string[] = [];

const parseDismissedRunIds = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : null;

// Hoisted so the setter (and with it each row's dismiss callback) keeps a
// stable identity across renders.
const DISMISSED_RUN_IDS_OPTIONS = { parse: parseDismissedRunIds };

const DelegatedRunRow = memo<{
  chat: RecentChat;
  onDismiss: (chatId: string) => void;
}>(({ chat, onDismiss }) => {
  const navigate = useNavigate();
  const storeStatus = useGenerationStatusStore(
    (state) => state.statusByChatId[chat.id],
  );
  const status = resolveDelegatedRunStatus(chat, storeStatus);

  const runTitle =
    resolveRecentChatTitle(chat.title_resolved) ??
    t({ id: "chat.newChat.title", message: "New Chat" });
  const name = chat.assistant_name ?? runTitle;
  const href = getChatUrl(chat.id, chat.assistant_id);

  const isLive = status === "running" || status === "action_required";
  const isSettled = status === "finished" || status === "error";
  // Elapsed anchors to the live generation's start when one is known; a
  // settled run shows when it last wrote instead.
  const liveStartedAt =
    storeStatus?.kind === "running" || storeStatus?.kind === "action_required"
      ? storeStatus.startedAt
      : (chat.active_generation_started_at ?? chat.pending_tool_approval_at);
  const timestamp =
    isLive && liveStartedAt ? liveStartedAt : chat.last_message_at;

  return (
    <a
      href={href}
      onClick={(e) => {
        // Allow cmd/ctrl-click to open in new tab
        if (e.metaKey || e.ctrlKey) {
          return;
        }
        e.preventDefault();
        navigate(href);
      }}
      className="focus-ring-inset block rounded-[var(--theme-radius-base)]"
      aria-label={
        status ? `${name}, ${chatAttentionStatusLabel(status)}` : name
      }
      data-testid="delegated-run-item"
    >
      <InteractiveContainer
        useDiv={true}
        showFocusRing={false}
        className="theme-transition group/run flex items-center gap-2 rounded-[var(--theme-radius-base)] px-2 py-1.5 text-left hover:bg-theme-bg-hover"
        data-chat-id={chat.id}
        data-ui="delegated-run-item"
      >
        {status && <ChatAttentionStatusDot status={status} />}
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={name}
        >
          {name}
        </span>
        <span className="shrink-0 text-xs text-theme-fg-secondary">
          <MessageTimestamp
            createdAt={new Date(timestamp)}
            autoUpdate={isLive}
          />
        </span>
        <OpenNewWindowIcon
          className="size-3.5 shrink-0 text-theme-fg-muted opacity-0 group-hover/run:opacity-100 group-focus-visible/run:opacity-100"
          aria-hidden="true"
        />
        {isSettled && (
          /* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- div exists to prevent bubbling */
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <Button
              variant="icon-only"
              size="sm"
              icon={<CheckIcon className="size-4" />}
              aria-label={t({
                id: "chat.history.delegatedRuns.dismiss",
                message: "Dismiss run",
              })}
              onClick={() => onDismiss(chat.id)}
              data-testid="delegated-run-dismiss"
            />
          </div>
        )}
      </InteractiveContainer>
    </a>
  );
});

// eslint-disable-next-line lingui/no-unlocalized-strings
DelegatedRunRow.displayName = "DelegatedRunRow";

export interface DelegatedRunsSectionProps {
  /** Chat the user is viewing; the listed runs are the ones it dispatched.
   * Callers with no open chat pass null or "". */
  chatId: string | null;
}

/**
 * Collapsible bar above the composer listing the background runs launched
 * from the open chat — in view even on small screens, where the sidebar is
 * hidden. Renders nothing while the chat has none. Collapsed by default and
 * session-local on purpose: the bar is a glance surface, not a panel whose
 * state deserves to outlive the visit.
 */
export const DelegatedRunsSection = memo<DelegatedRunsSectionProps>(
  ({ chatId }) => {
    const { enabled: assistantsEnabled, delegationEnabled } =
      useAssistantsFeature();
    const canHaveRuns = assistantsEnabled && delegationEnabled;
    // The params come from the shared builder so a dispatch frame's cache
    // seed lands under exactly this key.
    const { data } = useRecentChats(
      canHaveRuns && chatId
        ? { queryParams: delegatedRunsListingParams(chatId) }
        : skipToken,
    );
    const [dismissedRunIds, setDismissedRunIds] = usePersistedState(
      DISMISSED_DELEGATED_RUNS_STORAGE_KEY,
      NO_DISMISSED_RUN_IDS,
      DISMISSED_RUN_IDS_OPTIONS,
    );
    // Awaited delegations already delivered their answer inline to the
    // origin turn; only detached (background) runs have a life of their own
    // worth listing here. A row leaves this list through the persisted
    // check-off and nothing else: opening a run keeps both the row and its
    // settled status — the dot is a status column, not an unread marker —
    // so what the list shows never rides in-memory state a reload drops.
    const runs = useMemo(
      () =>
        (data?.chats ?? [])
          .filter(isBackgroundRun)
          .filter((chat) => !dismissedRunIds.includes(chat.id)),
      [data?.chats, dismissedRunIds],
    );

    const dismissRun = useCallback(
      (chatId: string) => {
        // Also consume a locally observed outcome so the attention badge
        // stops counting the checked-off run.
        useGenerationStatusStore.getState().consumeTerminalOutcome(chatId);
        setDismissedRunIds((previous) =>
          previous.includes(chatId)
            ? previous
            : [...previous, chatId].slice(-DISMISSED_RUNS_LIMIT),
        );
      },
      [setDismissedRunIds],
    );

    // Seed the status store from the listing's running and pending-approval
    // markers: the generating poll is gated on the store, so without this the
    // poll never starts and the rows would never observe a transition.
    useEffect(() => {
      seedGenerationStatusFromListing(runs);
    }, [runs]);

    const [isExpanded, setIsExpanded] = useState(false);

    // The header's hint follows the runs' own status vocabulary; a run that
    // is merely running asks for nothing, so it never raises the hint.
    const statusByChatId = useGenerationStatusStore(
      (state) => state.statusByChatId,
    );
    const attentionStatus = useMemo(() => {
      const statuses = runs.flatMap((chat) => {
        const status = resolveDelegatedRunStatus(chat, statusByChatId[chat.id]);
        return status && status !== "running" ? [status] : [];
      });
      return mostUrgentAttentionStatus(statuses);
    }, [runs, statusByChatId]);

    if (runs.length === 0) {
      return null;
    }

    return (
      <div
        // Mirrors the composer's own width channel so the bar and the input
        // read as one surface.
        className="mx-auto w-full px-2 pt-2 sm:px-4"
        style={{ maxWidth: "var(--theme-layout-chat-input-max-width)" }}
        data-ui="delegated-runs-section"
      >
        <div className="rounded-[var(--theme-radius-message)] border border-theme-border bg-theme-bg-primary">
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            aria-expanded={isExpanded}
            className="focus-ring-inset theme-transition flex w-full items-center gap-2 rounded-[var(--theme-radius-message)] px-3 py-2 text-left hover:bg-theme-bg-hover"
            data-testid="delegated-runs-toggle"
          >
            <ChevronRightIcon
              className={clsx(
                "theme-transition size-3 shrink-0 text-theme-fg-muted",
                isExpanded ? "rotate-90" : "rotate-0",
              )}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-semibold text-theme-fg-secondary">
              {t({
                id: "chat.history.delegatedRuns",
                message: "Delegated runs",
              })}
            </span>
            <span
              className="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-theme-bg-secondary px-1 text-[10px] font-semibold leading-4 text-theme-fg-secondary"
              data-testid="delegated-runs-count"
            >
              {runs.length}
            </span>
            {attentionStatus && (
              <ChatAttentionStatusDot status={attentionStatus} />
            )}
          </button>
          <Collapse isOpen={isExpanded}>
            {isExpanded && (
              <div
                className="flex w-full min-w-0 flex-col gap-0.5 px-1.5 pb-1.5"
                data-ui="delegated-runs-list"
              >
                {runs.map((chat) => (
                  <DelegatedRunRow
                    key={chat.id}
                    chat={chat}
                    onDismiss={dismissRun}
                  />
                ))}
              </div>
            )}
          </Collapse>
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
DelegatedRunsSection.displayName = "DelegatedRunsSection";
