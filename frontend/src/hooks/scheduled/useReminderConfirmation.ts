import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  SCHEDULED_ITEMS_QUERY_KEY,
  scheduledRefusalCode,
  scheduledRefusalMessage,
} from "@/components/ui/Scheduled/scheduledApi";
import {
  useCancelScheduledItem,
  useGetScheduledItem,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import type { ScheduledItemStatus } from "@/components/ui/Scheduled/ScheduledStatusPill";

/** What became of a reminder since it was confirmed; `gone` once deleted. */
export type ReminderConfirmationStatus = ScheduledItemStatus | "gone";

export interface ReminderConfirmationState {
  /** The reminder's status now; undefined until it is known. */
  status: ReminderConfirmationStatus | undefined;
  isCancelling: boolean;
  /** Why Cancel was refused, in the user's language. */
  cancelError: string | null;
  cancel: () => void;
}

/**
 * The live state of a reminder a chat confirmed, and its Cancel. The card
 * shows what was stored at creation; this says whether that still holds, so a
 * reloaded chat does not offer Cancel on a reminder that is already over.
 */
export function useReminderConfirmation(
  itemId: string,
): ReminderConfirmationState {
  const queryClient = useQueryClient();
  const live = useGetScheduledItem(
    { pathParams: { itemId } },
    // A deleted reminder answers 404 for good; the card says so at once.
    { retry: false },
  );
  const {
    mutate,
    data: cancelled,
    error,
    isPending,
  } = useCancelScheduledItem({
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SCHEDULED_ITEMS_QUERY_KEY }),
  });

  const cancel = useCallback(
    () => mutate({ pathParams: { itemId } }),
    [mutate, itemId],
  );

  const status: ReminderConfirmationStatus | undefined =
    cancelled?.status ??
    live.data?.status ??
    (scheduledRefusalCode(live.error) === "not_found" ? "gone" : undefined);

  return {
    status,
    isCancelling: isPending,
    cancelError: error
      ? scheduledRefusalMessage(scheduledRefusalCode(error))
      : null,
    cancel,
  };
}
