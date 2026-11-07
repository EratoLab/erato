import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/ui/Container/PageHeader";
import { TabRail } from "@/components/ui/Controls/TabRail";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { ScheduledFailureAlert } from "@/components/ui/Scheduled/ScheduledFailureAlert";
import { ScheduledItemGroups } from "@/components/ui/Scheduled/ScheduledItemGroups";
import { ScheduledNewMenu } from "@/components/ui/Scheduled/ScheduledNewMenu";
import { ScheduledPageNoticeAlert } from "@/components/ui/Scheduled/ScheduledPageNoticeAlert";
import { ScheduledTemplates } from "@/components/ui/Scheduled/ScheduledTemplates";
import {
  groupScheduledItemsByDay,
  scheduledItemTab,
} from "@/components/ui/Scheduled/scheduledItems";
import {
  useScheduledItems,
  useScheduledTemplates,
} from "@/hooks/scheduled/useScheduledItems";
import { usePageAlignment } from "@/hooks/ui";

import { EmptyAssistantHubState } from "./assistantHubUtils";

import type { ScheduledItemActions } from "@/components/ui/Scheduled/ScheduledItemRow";
import type { ScheduledPageNotice } from "@/components/ui/Scheduled/scheduledApi";
import type {
  ScheduledItem,
  ScheduledTab,
  ScheduledTemplate,
} from "@/components/ui/Scheduled/scheduledItems";

const FAILURE_ALERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScheduledPageViewProps extends ScheduledItemActions {
  items: ScheduledItem[];
  /**
   * Item counts per tab when they can exceed what `items` holds (the API
   * lists only the latest past items); counted from `items` when omitted.
   */
  counts?: Record<ScheduledTab, number>;
  /** Whether anything new can be scheduled, shown above the list. */
  notice?: ScheduledPageNotice | null;
  templates: ScheduledTemplate[];
  isLoading?: boolean;
  error?: Error | null;
  initialTab?: ScheduledTab;
  onNewReminder: () => void;
  onCreateWithChat?: () => void;
  onTemplateSelect: (template: ScheduledTemplate) => void;
  /** Reference time for the day groups; the current time when omitted. */
  now?: Date;
  /** IANA zone for days and times; the browser's zone when omitted. */
  timeZone?: string;
}

/**
 * The Scheduled page, fed entirely by props: header with the New menu, the
 * Upcoming and Past tabs, failed items as an alert, and the day-grouped list
 * or, with nothing scheduled at all, the empty state with templates.
 */
export function ScheduledPageView({
  items,
  counts,
  notice = null,
  templates,
  isLoading = false,
  error = null,
  initialTab = "upcoming",
  onNewReminder,
  onCreateWithChat,
  onTemplateSelect,
  now,
  timeZone,
  ...rowActions
}: ScheduledPageViewProps) {
  const { i18n } = useLingui();
  const { justifyAlignment } = usePageAlignment("headers");
  const { containerClasses, horizontalPadding } =
    usePageAlignment("assistants");
  const [tab, setTab] = useState<ScheduledTab>(initialTab);
  const [failureDismissed, setFailureDismissed] = useState(false);

  const locale = i18n.locale || undefined;
  const dateContext = useMemo(() => ({ locale, timeZone }), [locale, timeZone]);

  const byTab = useMemo(() => {
    const upcoming: ScheduledItem[] = [];
    const past: ScheduledItem[] = [];
    for (const item of items) {
      (scheduledItemTab(item) === "upcoming" ? upcoming : past).push(item);
    }
    return { upcoming, past };
  }, [items]);

  const groups = useMemo(
    () =>
      groupScheduledItemsByDay(byTab[tab], tab, {
        ...dateContext,
        now: now ?? new Date(),
      }),
    [byTab, tab, dateContext, now],
  );

  // Past keeps failures for good, so only the recent ones still call for the
  // alert; older ones stay in the list.
  const failedItems = useMemo(() => {
    const since = (now ?? new Date()).getTime() - FAILURE_ALERT_WINDOW_MS;
    return items.filter(
      (item) => item.status === "failed" && Date.parse(item.dueAt) >= since,
    );
  }, [items, now]);

  const tabLabel = (value: ScheduledTab) => {
    const count = counts?.[value] ?? byTab[value].length;
    if (value === "upcoming") {
      return count > 0
        ? t({
            id: "scheduled.tabs.upcoming.count",
            message: `Upcoming (${count})`,
          })
        : t({ id: "scheduled.tabs.upcoming", message: "Upcoming" });
    }
    return count > 0
      ? t({ id: "scheduled.tabs.past.count", message: `Past (${count})` })
      : t({ id: "scheduled.tabs.past", message: "Past" });
  };

  const pageTitle = t({ id: "scheduled.page.title", message: "Scheduled" });

  useEffect(() => {
    document.title = `${pageTitle} - ${t({
      id: "branding.page_title_suffix",
    })}`;
  }, [pageTitle]);

  const hasNoItems = counts
    ? counts.upcoming + counts.past === 0
    : items.length === 0;

  let content: React.ReactNode;
  if (isLoading) {
    content = (
      <div className="flex justify-center py-12">
        <SpinnerIcon
          size="xl"
          label={t({
            id: "scheduled.loading",
            message: "Loading scheduled items...",
          })}
        />
      </div>
    );
  } else if (error) {
    content = (
      <Alert type="error">
        {t({
          id: "scheduled.error.load",
          message: "Your scheduled items could not be loaded.",
        })}
      </Alert>
    );
  } else if (hasNoItems) {
    content = (
      <>
        {notice && <ScheduledPageNoticeAlert notice={notice} />}
        <EmptyAssistantHubState
          title={t({
            id: "scheduled.empty.title",
            message: "Nothing scheduled yet",
          })}
          description={t({
            id: "scheduled.empty.description",
            message:
              "Get a reminder at a time you choose, or describe it in a chat and Erato sets it up.",
          })}
        />
        <ScheduledTemplates templates={templates} onSelect={onTemplateSelect} />
      </>
    );
  } else {
    content = (
      <>
        {notice && <ScheduledPageNoticeAlert notice={notice} />}
        {!failureDismissed && (
          <ScheduledFailureAlert
            failedItems={failedItems}
            dateContext={dateContext}
            onShowPast={tab === "past" ? undefined : () => setTab("past")}
            onDismiss={() => setFailureDismissed(true)}
          />
        )}
        {groups.length > 0 ? (
          <ScheduledItemGroups
            groups={groups}
            dateContext={dateContext}
            {...rowActions}
          />
        ) : tab === "upcoming" ? (
          <EmptyAssistantHubState
            title={t({
              id: "scheduled.empty.upcoming.title",
              message: "Nothing upcoming",
            })}
            description={t({
              id: "scheduled.empty.upcoming.description",
              message: "What you schedule next shows up here.",
            })}
          />
        ) : (
          <EmptyAssistantHubState
            title={t({
              id: "scheduled.empty.past.title",
              message: "Nothing in the past yet",
            })}
            description={t({
              id: "scheduled.empty.past.description",
              message:
                "Items move here once they are done, have failed or were cancelled.",
            })}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col bg-theme-bg-primary">
      <PageHeader
        density="compact"
        title={pageTitle}
        subtitle={t({
          id: "scheduled.page.subtitle",
          message: "Everything Erato does for you at a time you choose.",
        })}
      >
        <div className={clsx("flex", justifyAlignment)}>
          <ScheduledNewMenu
            onNewReminder={onNewReminder}
            onCreateWithChat={onCreateWithChat}
          />
        </div>
      </PageHeader>
      <div
        className={clsx(
          "flex-1 overflow-auto [scrollbar-gutter:stable_both-edges]",
          horizontalPadding,
        )}
        data-ui="assistants-page-scroll-container"
      >
        <div className={clsx("space-y-8 py-6", containerClasses)}>
          <div
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            data-ui="assistants-page-toolbar"
          >
            <TabRail
              variant="rail"
              orientation="horizontal"
              className="flex-wrap"
              tabClassName="font-medium"
              options={[
                { value: "upcoming", label: tabLabel("upcoming") },
                { value: "past", label: tabLabel("past") },
              ]}
              value={tab}
              onChange={setTab}
              aria-label={t({
                id: "scheduled.tabs.aria",
                message: "Filter scheduled items",
              })}
            />
          </div>
          {content}
        </div>
      </div>
    </div>
  );
}

/**
 * Route page. The facet-preselected chat comes with ERMAIN-1143.
 */
export default function ScheduledPage() {
  const navigate = useNavigate();
  const {
    items,
    counts,
    timeZone,
    notice,
    isLoading,
    error,
    snooze,
    cancel,
    remove,
  } = useScheduledItems();
  const templates = useScheduledTemplates();

  return (
    <ScheduledPageView
      items={items}
      counts={counts}
      notice={notice}
      timeZone={timeZone}
      templates={templates}
      isLoading={isLoading}
      error={error}
      onNewReminder={() => navigate("/scheduled/new")}
      onTemplateSelect={(template) =>
        navigate(
          `/scheduled/new?${new URLSearchParams({ template: template.id }).toString()}`,
        )
      }
      onEdit={(item) => navigate(`/scheduled/${item.id}/edit`)}
      onScheduleAgain={(item) =>
        navigate(
          `/scheduled/new?${new URLSearchParams({ from: item.id }).toString()}`,
        )
      }
      onSnooze={snooze}
      onCancel={cancel}
      onDelete={remove}
      onOpenLinkedChat={(item) => {
        if (item.linkedChat) navigate(`/chat/${item.linkedChat.id}`);
      }}
    />
  );
}
