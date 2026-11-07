import { t } from "@lingui/core/macro";

import type {
  ScheduledItem,
  ScheduledItemChannel,
  ScheduledTab,
} from "./scheduledItems";
import type {
  DeliveryChannelInfo,
  DeliveryChannelStatus,
  ScheduledItem as ApiScheduledItem,
  ScheduledItemErrorCode,
  ScheduledItemsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Prefix of every scheduled-items query key (list per tab and single item),
 * for invalidating them together after a change.
 */
export const SCHEDULED_ITEMS_QUERY_KEY = [
  "api",
  "v1beta",
  "me",
  "scheduled-items",
];

/* eslint-disable lingui/no-unlocalized-strings -- wire values and kinds, not copy */
const TEAMS_PERSONAL = "teams_personal";

const CHANNEL_FROM_API: Record<string, ScheduledItemChannel> = {
  [TEAMS_PERSONAL]: "teams_chat",
};

const CHANNEL_TO_API: Record<ScheduledItemChannel, string> = {
  teams_chat: TEAMS_PERSONAL,
};

export function scheduledChannelFromApi(
  channel: string,
): ScheduledItemChannel | null {
  return CHANNEL_FROM_API[channel] ?? null;
}

export function scheduledChannelToApi(channel: ScheduledItemChannel): string {
  return CHANNEL_TO_API[channel];
}

/** One API item as the page's view model. */
export function scheduledItemFromApi(
  item: ApiScheduledItem,
  tab: ScheduledTab,
): ScheduledItem {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    message: item.message || null,
    status: item.status,
    // Upcoming items show when they arrive next, finished ones when they were
    // due; an item cancelled before any occurrence has neither.
    dueAt:
      item.next_occurrence?.at ?? item.last_delivery?.due.at ?? item.updated_at,
    channel: scheduledChannelFromApi(item.channel),
    linkedChat: item.linked_chat ?? null,
    tab,
  };
}

export function scheduledChannelStatus(
  channels: DeliveryChannelInfo[],
  channel: ScheduledItemChannel,
): DeliveryChannelStatus {
  const wire = scheduledChannelToApi(channel);
  return (
    channels.find((entry) => entry.channel === wire)?.status ?? "unavailable"
  );
}

/** A notice above the list about whether anything new can be scheduled. */
export type ScheduledPageNotice =
  | { kind: "delivery_not_set_up" }
  | { kind: "delivery_unavailable" }
  | { kind: "limit_reached"; max: number };

/** Whether no delivery channel reaches the user. */
export function scheduledNoChannelConnected(
  channels: DeliveryChannelInfo[],
): boolean {
  return !channels.some((channel) => channel.status === "connected");
}

/** Whether the user has as many upcoming items as they may; 0 sets no limit. */
export function scheduledLimitReached(
  upcomingCount: number,
  maxUpcoming: number | undefined,
): boolean {
  return maxUpcoming != null && maxUpcoming > 0 && upcomingCount >= maxUpcoming;
}

export function scheduledPageNotice(
  response: Pick<
    ScheduledItemsResponse,
    "channels" | "upcoming_count" | "max_upcoming"
  >,
): ScheduledPageNotice | null {
  if (scheduledNoChannelConnected(response.channels)) {
    return response.channels.some((channel) => channel.status === "not_set_up")
      ? { kind: "delivery_not_set_up" }
      : { kind: "delivery_unavailable" };
  }
  if (scheduledLimitReached(response.upcoming_count, response.max_upcoming)) {
    return { kind: "limit_reached", max: response.max_upcoming };
  }
  return null;
}
/* eslint-enable lingui/no-unlocalized-strings */

/** Why nothing new can be scheduled at the limit; names no item type. */
export function scheduledLimitMessage(max: number): string {
  return t({
    id: "scheduled.notice.limitReached",
    message: `You have the maximum of ${max} upcoming items. Cancel one to schedule another.`,
  });
}

export type ScheduledRefusalCode = ScheduledItemErrorCode;

/**
 * The refusal code of a failed request, or null for a network error or a
 * response without one. The generated fetcher throws the parsed error body
 * itself; the `{ status, payload }` shape is its fallback for bodies it could
 * not parse.
 */
export function scheduledRefusalCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  if (
    "payload" in error &&
    typeof error.payload === "object" &&
    error.payload !== null &&
    "code" in error.payload &&
    typeof error.payload.code === "string"
  ) {
    return error.payload.code;
  }
  return null;
}

/** What to tell the user about a refusal, in their language. */
export function scheduledRefusalMessage(code: string | null): string {
  switch (code as ScheduledRefusalCode | null) {
    case "not_found":
      return t({
        id: "scheduled.refusal.notFound",
        message: "This item no longer exists.",
      });
    case "invalid_request":
      return t({
        id: "scheduled.refusal.invalidRequest",
        message: "Check the name and the message: both are required.",
      });
    case "type_not_available":
      return t({
        id: "scheduled.refusal.typeNotAvailable",
        message: "This type is not available yet.",
      });
    case "invalid_trigger":
      return t({
        id: "scheduled.refusal.invalidTrigger",
        message: "This schedule does not work. Check the days and dates.",
      });
    case "trigger_in_past":
      return t({
        id: "scheduled.refusal.triggerInPast",
        message: "This time is in the past. Pick a time in the future.",
      });
    case "linked_chat_not_found":
      return t({
        id: "scheduled.refusal.linkedChatNotFound",
        message: "The linked chat no longer exists. Pick another one.",
      });
    case "channel_unknown":
    case "channel_unavailable":
      return t({
        id: "scheduled.refusal.channelUnavailable",
        message: "This delivery channel is not available here.",
      });
    case "channel_not_set_up":
      return t({
        id: "scheduled.refusal.channelNotSetUp",
        message:
          "Erato can't reach you on this delivery channel yet. Set it up first.",
      });
    case "limit_reached":
      return t({
        id: "scheduled.refusal.limitReached",
        message:
          "You have the maximum number of upcoming items. Cancel one first.",
      });
    case "finished":
      return t({
        id: "scheduled.refusal.finished",
        message: "This item is already over.",
      });
    case "in_flight":
      return t({
        id: "scheduled.refusal.inFlight",
        message:
          "This item is being delivered right now. Try again in a moment.",
      });
    case "nothing_to_snooze":
      return t({
        id: "scheduled.refusal.nothingToSnooze",
        message: "Nothing of this item is waiting to be delivered.",
      });
    case "not_finished":
      return t({
        id: "scheduled.refusal.notFinished",
        message: "Only items that are over can be deleted.",
      });
    default:
      return t({
        id: "scheduled.refusal.unknown",
        message: "Something went wrong. Please try again.",
      });
  }
}
