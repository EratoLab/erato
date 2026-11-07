/* eslint-disable lingui/no-unlocalized-strings -- sample data for stories and tests */
import type { ScheduledItem, ScheduledTemplate } from "./scheduledItems";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A local wall-clock time `days` from `now`, as an ISO string. */
const at = (now: Date, days: number, hours: number, minutes = 0) => {
  const date = new Date(now.getTime() + days * DAY);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

/**
 * Sample items for stories and tests: every status, linked and unlinked
 * chats, and one failure, dated around `now` so the day groups fill.
 */
export function createScheduledItemFixtures(now: Date): ScheduledItem[] {
  return [
    {
      id: "fixture-rate-call",
      type: "reminder",
      name: "Prepare for the Q4 rate call with Nordhafen Logistik",
      message: "Bring the rate comparison from last week.",
      status: "scheduled",
      dueAt: at(now, 2, 8, 30),
      channel: "teams_chat",
      linkedChat: { id: "fixture-chat-rates", title: "Q4 rate comparison" },
    },
    {
      id: "fixture-offer-follow-up",
      type: "reminder",
      name: "Follow up on the offer for Müller GmbH",
      message:
        "Ask whether they need the revised sea freight rates before they decide.",
      status: "snoozed",
      dueAt: at(now, 2, 10),
      channel: "teams_chat",
      linkedChat: {
        id: "fixture-chat-offer",
        title: "Offer Müller GmbH, sea freight",
      },
    },
    {
      id: "fixture-packing-list",
      type: "reminder",
      name: "Send the revised packing list for container 4711",
      status: "scheduled",
      dueAt: at(now, 6, 9),
      channel: "teams_chat",
      linkedChat: {
        id: "fixture-chat-packing",
        title: "Packing list check, container 4711",
      },
    },
    {
      id: "fixture-customs-documents",
      type: "reminder",
      name: "Check that the customs documents for Rotterdam arrived",
      status: "scheduled",
      dueAt: at(now, 16, 9),
      channel: "teams_chat",
    },
    {
      id: "fixture-call-back",
      type: "reminder",
      name: "Call Ms Schulz back about the delivery date",
      status: "done",
      dueAt: at(now, -2, 14),
      channel: "teams_chat",
    },
    {
      id: "fixture-trucks",
      type: "reminder",
      name: "Book the trucks for week 46",
      status: "done",
      dueAt: at(now, -3, 9),
      channel: "teams_chat",
      linkedChat: { id: "fixture-chat-rates", title: "Q4 rate comparison" },
    },
    {
      id: "fixture-customs-status",
      type: "reminder",
      name: "Check the customs clearance status",
      status: "failed",
      dueAt: at(now, -4, 9),
      channel: "teams_chat",
    },
    {
      id: "fixture-framework-contract",
      type: "reminder",
      name: "Ask for the signed framework contract",
      status: "cancelled",
      dueAt: at(now, -5, 9),
      channel: "teams_chat",
    },
  ];
}

/** Sample templates for stories and tests. */
export const SCHEDULED_TEMPLATE_FIXTURES: ScheduledTemplate[] = [
  {
    id: "follow-up-offer",
    type: "reminder",
    title: "Follow up on an offer",
    description: "Ask a customer whether they decided on your offer",
    name: "Follow up on the offer for Müller GmbH",
    message:
      "Ask whether they need the revised sea freight rates before they decide.",
  },
  {
    id: "prepare-meeting",
    type: "reminder",
    title: "Prepare for a meeting",
    description: "A nudge an hour before, with what to bring",
    name: "Prepare for the meeting",
    message: "Bring the agenda and the figures from last time.",
  },
  {
    id: "before-deadline",
    type: "reminder",
    title: "Before a deadline",
    description: "Two days ahead of a cut-off or closing date",
    name: "Deadline in two days",
    message: "Check what is still missing before the cut-off.",
  },
  {
    id: "continue-chat",
    type: "reminder",
    title: "Continue a chat later",
    description: "Pick up one of your chats where you left off",
    name: "Continue where I left off",
    message: "Pick up the open points from the linked chat.",
  },
  {
    id: "call-back",
    type: "reminder",
    title: "Call a customer back",
    description: "A reminder with the number and the topic",
    name: "Call the customer back",
    message: "Number: … Topic: …",
  },
  {
    id: "check-delivery",
    type: "reminder",
    title: "Check in after a delivery",
    description: "Ask whether the goods arrived complete",
    name: "Check in after the delivery",
    message: "Ask whether the goods arrived complete and undamaged.",
  },
];
