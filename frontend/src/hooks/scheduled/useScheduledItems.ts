import { t } from "@lingui/core/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  SCHEDULED_ITEMS_QUERY_KEY,
  scheduledItemFromApi,
  scheduledPageNotice,
  scheduledRefusalCode,
  scheduledRefusalMessage,
} from "@/components/ui/Scheduled/scheduledApi";
import { scheduledFailureAlertItems } from "@/components/ui/Scheduled/scheduledItems";
import { snoozeUntil } from "@/components/ui/Scheduled/scheduledTime";
import { usePageErrorToast } from "@/components/ui/Toast/usePageErrorToast";
import {
  useCancelScheduledItem,
  useDeleteScheduledItem,
  useListScheduledItems,
  useListScheduledTemplates,
  useSnoozeScheduledItem,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ScheduledPageNotice } from "@/components/ui/Scheduled/scheduledApi";
import type {
  ScheduledItem,
  ScheduledTemplate,
} from "@/components/ui/Scheduled/scheduledItems";
import type { ScheduledItemsResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ScheduledItemsState {
  /** Both tabs' items; each carries the tab the API listed it under. */
  items: ScheduledItem[];
  /** The API's counts: Past lists at most the latest 100 items. */
  counts: { upcoming: number; past: number } | undefined;
  /** The zone the user's times are entered and shown in. */
  timeZone: string | undefined;
  notice: ScheduledPageNotice | null;
  /** How many upcoming items the user may have. */
  maxUpcoming: number | undefined;
  isLoading: boolean;
  error: Error | null;
  snooze: (item: ScheduledItem) => void;
  cancel: (item: ScheduledItem) => void;
  remove: (item: ScheduledItem) => void;
}

function bothTabs(
  upcoming: ScheduledItemsResponse | undefined,
  past: ScheduledItemsResponse | undefined,
): ScheduledItem[] {
  return [
    ...(upcoming?.items ?? []).map((item) =>
      scheduledItemFromApi(item, "upcoming"),
    ),
    ...(past?.items ?? []).map((item) => scheduledItemFromApi(item, "past")),
  ];
}

const asError = (error: unknown): Error | null =>
  error == null
    ? null
    : error instanceof Error
      ? error
      : new Error(scheduledRefusalMessage(scheduledRefusalCode(error)));

/**
 * The user's scheduled items for the Scheduled page: both tabs from the
 * scheduled items API, mapped onto the page's view model, and the row actions.
 * Every action refetches the lists when it settles, since one change moves an
 * item between tabs and changes both counts.
 */
export function useScheduledItems(): ScheduledItemsState {
  const queryClient = useQueryClient();
  const showError = usePageErrorToast();
  const upcoming = useListScheduledItems({ queryParams: { tab: "upcoming" } });
  const past = useListScheduledItems({ queryParams: { tab: "past" } });

  const refetch = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: SCHEDULED_ITEMS_QUERY_KEY }),
    [queryClient],
  );

  const reportFailure = useCallback(
    (title: string, error: unknown) => {
      showError({
        title,
        description: scheduledRefusalMessage(scheduledRefusalCode(error)),
      });
    },
    [showError],
  );

  const { mutate: snoozeItem } = useSnoozeScheduledItem({
    onSettled: refetch,
  });
  const { mutate: cancelItem } = useCancelScheduledItem({
    onSettled: refetch,
  });
  const { mutate: deleteItem } = useDeleteScheduledItem({
    onSettled: refetch,
  });

  const latest = upcoming.data ?? past.data;
  const timeZone = latest?.time_zone;

  const items = useMemo(
    () => bothTabs(upcoming.data, past.data),
    [upcoming.data, past.data],
  );

  const snooze = useCallback(
    (item: ScheduledItem) => {
      const name = item.name;
      snoozeItem(
        {
          pathParams: { itemId: item.id },
          body: { until: snoozeUntil(new Date(), timeZone).toISOString() },
        },
        {
          onError: (error) =>
            reportFailure(
              t({
                id: "scheduled.snooze.failed",
                message: `“${name}” could not be snoozed`,
              }),
              error,
            ),
        },
      );
    },
    [snoozeItem, reportFailure, timeZone],
  );

  const cancel = useCallback(
    (item: ScheduledItem) => {
      const name = item.name;
      cancelItem(
        { pathParams: { itemId: item.id } },
        {
          onError: (error) =>
            reportFailure(
              t({
                id: "scheduled.cancel.failed",
                message: `“${name}” could not be cancelled`,
              }),
              error,
            ),
        },
      );
    },
    [cancelItem, reportFailure],
  );

  const remove = useCallback(
    (item: ScheduledItem) => {
      const name = item.name;
      deleteItem(
        { pathParams: { itemId: item.id } },
        {
          onError: (error) =>
            reportFailure(
              t({
                id: "scheduled.delete.failed",
                message: `“${name}” could not be deleted`,
              }),
              error,
            ),
        },
      );
    },
    [deleteItem, reportFailure],
  );

  return {
    items,
    counts: latest
      ? { upcoming: latest.upcoming_count, past: latest.past_count }
      : undefined,
    timeZone,
    notice: latest ? scheduledPageNotice(latest) : null,
    maxUpcoming: latest?.max_upcoming,
    isLoading: upcoming.isLoading || past.isLoading,
    error: asError(upcoming.error ?? past.error),
    snooze,
    cancel,
    remove,
  };
}

/**
 * Whether the Scheduled page shows its failure alert, for the warning dot on
 * the sidebar entry. It reads the page's own two lists from the shared cache
 * and the same condition, so the dot and the alert always agree; a list that
 * failed to load shows the page's load error instead, so no dot either.
 */
export function useScheduledFailureAlertShown(): boolean {
  const upcoming = useListScheduledItems({ queryParams: { tab: "upcoming" } });
  const past = useListScheduledItems({ queryParams: { tab: "past" } });
  const failed = upcoming.error != null || past.error != null;
  return useMemo(
    () =>
      !failed &&
      scheduledFailureAlertItems(bothTabs(upcoming.data, past.data), new Date())
        .length > 0,
    [failed, upcoming.data, past.data],
  );
}

const NO_TEMPLATES: ScheduledTemplate[] = [];

/**
 * The templates the deployment configures, for the empty page and the form.
 * A deployment without any, or a failed request, shows none.
 */
export function useScheduledTemplates(): {
  templates: ScheduledTemplate[];
  isLoading: boolean;
} {
  const { data, isLoading } = useListScheduledTemplates(
    {},
    // Configuration: it changes with a deployment, not while the page is open.
    { staleTime: 5 * 60 * 1000, retry: false },
  );
  return { templates: data?.templates ?? NO_TEMPLATES, isLoading };
}
