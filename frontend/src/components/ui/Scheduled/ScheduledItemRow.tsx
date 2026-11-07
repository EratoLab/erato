import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Fragment } from "react";

import { ScheduledStatusPill } from "./ScheduledStatusPill";
import {
  formatScheduledDateTime,
  scheduledChannelLabel,
  scheduledItemTab,
  scheduledTypeLabel,
} from "./scheduledItems";
import { SCHEDULED_SNOOZE_HOUR } from "./scheduledTime";
import { Card } from "../Container/Card";
import { Button } from "../Controls/Button";
import { DropdownMenu } from "../Controls/DropdownMenu";
import { MessageTimestamp } from "../Message/MessageTimestamp";
import {
  CalendarIcon,
  ChatBubbleIcon,
  ClockIcon,
  CloseIcon,
  EditIcon,
  Trash,
} from "../icons";

import type { ScheduledDateFormat, ScheduledItem } from "./scheduledItems";
import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ReactNode } from "react";

export interface ScheduledItemActions {
  onEdit: (item: ScheduledItem) => void;
  onSnooze: (item: ScheduledItem) => void;
  onCancel: (item: ScheduledItem) => void;
  onOpenLinkedChat: (item: ScheduledItem) => void;
  onScheduleAgain: (item: ScheduledItem) => void;
  /** Past items only. */
  onDelete: (item: ScheduledItem) => void;
}

interface ScheduledItemRowProps extends ScheduledItemActions {
  item: ScheduledItem;
  /** Zone and locale the times are shown in. */
  dateContext: ScheduledDateFormat;
}

/**
 * The parts of the meta line: type first, then when and how it went out. The
 * channel is named here and nowhere at page level.
 */
function metaParts(
  item: ScheduledItem,
  dateContext: ScheduledDateFormat,
): ReactNode[] {
  const when = formatScheduledDateTime(item.dueAt, dateContext);
  const relative = (
    <MessageTimestamp createdAt={new Date(item.dueAt)} autoUpdate />
  );
  const channel = item.channel ? scheduledChannelLabel(item.channel) : null;
  const chatTitle = item.linkedChat?.title;
  const linkedChat = chatTitle
    ? t({
        id: "scheduled.item.meta.linkedChat",
        message: `Linked chat: ${chatTitle}`,
      })
    : null;
  const via = channel
    ? t({ id: "scheduled.item.meta.via", message: `via ${channel}` })
    : null;

  const parts: (ReactNode | null)[] = [scheduledTypeLabel(item.type)];
  switch (item.status) {
    case "scheduled":
      parts.push(when, relative, via, linkedChat);
      break;
    case "snoozed":
      parts.push(
        t({
          id: "scheduled.item.meta.snoozedUntil",
          message: `Snoozed until ${when}`,
        }),
        relative,
        via,
        linkedChat,
      );
      break;
    case "done":
      parts.push(
        channel
          ? t({
              id: "scheduled.item.meta.deliveredVia",
              message: `Delivered via ${channel}`,
            })
          : null,
        when,
        relative,
        linkedChat,
      );
      break;
    case "failed":
      parts.push(
        channel
          ? t({
              id: "scheduled.item.meta.notDeliveredVia",
              message: `Could not be delivered via ${channel}`,
            })
          : null,
        when,
        relative,
        linkedChat,
      );
      break;
    case "cancelled":
      parts.push(
        t({ id: "scheduled.item.meta.cancelled", message: "Cancelled" }),
        t({ id: "scheduled.item.meta.wasDue", message: `Was due ${when}` }),
      );
      break;
  }
  return parts.filter((part) => part != null);
}

/**
 * One scheduled item: name and status, the message, and a meta line with type,
 * time and channel. Upcoming items edit, snooze and cancel; past ones offer to
 * schedule the same again.
 */
export function ScheduledItemRow({
  item,
  dateContext,
  onEdit,
  onSnooze,
  onCancel,
  onOpenLinkedChat,
  onScheduleAgain,
  onDelete,
}: ScheduledItemRowProps) {
  const { i18n } = useLingui();
  const name = item.name;
  const isUpcoming = scheduledItemTab(item) === "upcoming";
  const snoozeTime = new Intl.DateTimeFormat(i18n.locale || undefined, {
    hour: "numeric",
    minute: "2-digit", // eslint-disable-line lingui/no-unlocalized-strings
  }).format(new Date(2000, 0, 1, SCHEDULED_SNOOZE_HOUR));

  const openLinkedChat: DropdownMenuItem[] = item.linkedChat
    ? [
        {
          id: "open-linked-chat",
          label: t({
            id: "scheduled.item.action.openLinkedChat",
            message: "Open linked chat",
          }),
          icon: <ChatBubbleIcon className="size-4" />,
          onClick: () => onOpenLinkedChat(item),
        },
      ]
    : [];

  const menuItems: DropdownMenuItem[] = isUpcoming
    ? [
        {
          id: "edit",
          label: t({ id: "scheduled.item.action.edit", message: "Edit" }),
          icon: <EditIcon className="size-4" />,
          onClick: () => onEdit(item),
        },
        {
          id: "snooze",
          label: t({
            id: "scheduled.item.action.snoozeUntilTomorrow",
            message: `Snooze until tomorrow, ${snoozeTime}`,
          }),
          icon: <ClockIcon className="size-4" />,
          onClick: () => onSnooze(item),
        },
        ...openLinkedChat,
        {
          id: "cancel",
          label: t({ id: "scheduled.item.action.cancel", message: "Cancel" }),
          icon: <CloseIcon className="size-4" />,
          variant: "danger",
          onClick: () => onCancel(item),
          confirmAction: true,
          confirmTitle: t({
            id: "scheduled.item.cancel.confirmTitle",
            message: `Cancel “${name}”?`,
          }),
          confirmMessage: t({
            id: "scheduled.item.cancel.confirmMessage",
            message:
              "It will not be carried out. You can still find it under Past.",
          }),
          confirmButtonText: t({
            id: "scheduled.item.cancel.confirm",
            message: "Cancel it",
          }),
          confirmCancelButtonText: t({
            id: "scheduled.item.cancel.keep",
            message: "Keep it",
          }),
        },
      ]
    : [
        ...openLinkedChat,
        {
          id: "schedule-again",
          label: t({
            id: "scheduled.item.action.scheduleAgain",
            message: "Schedule again",
          }),
          icon: <CalendarIcon className="size-4" />,
          onClick: () => onScheduleAgain(item),
        },
        {
          id: "delete",
          label: t({ id: "scheduled.item.action.delete", message: "Delete" }),
          icon: <Trash className="size-4" />,
          variant: "danger",
          separatorBefore: true,
          onClick: () => onDelete(item),
          confirmAction: true,
          confirmTitle: t({
            id: "scheduled.item.delete.confirmTitle",
            message: `Delete “${name}”?`,
          }),
          confirmMessage: t({
            id: "scheduled.item.delete.confirmMessage",
            message: "It is removed from your list for good.",
          }),
          confirmButtonText: t({
            id: "scheduled.item.delete.confirm",
            message: "Delete",
          }),
        },
      ];

  return (
    <Card
      variant="surface"
      as="article"
      // Shares the assistants list card hook so a theme styles both lists alike.
      data-ui="assistant-list-card"
      data-testid="scheduled-item"
      data-status={item.status}
      aria-label={item.name}
      bodyClassName="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-theme-fg-primary">
            {item.name}
          </h3>
          <ScheduledStatusPill status={item.status} />
        </div>
        {item.message && (
          <p className="mt-2 line-clamp-2 text-sm text-theme-fg-secondary">
            {item.message}
          </p>
        )}
        {item.status === "failed" && item.failureReason && (
          <p className="mt-2 text-sm text-theme-error-fg">
            {item.failureReason}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-fg-muted">
          {metaParts(item, dateContext).map((part, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <span className="inline-flex min-h-6 items-center">{part}</span>
            </Fragment>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <DropdownMenu
          items={menuItems}
          noWrapItems
          triggerAriaLabel={t({
            id: "scheduled.item.actions.aria",
            message: `Actions for ${name}`,
          })}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => (isUpcoming ? onEdit(item) : onScheduleAgain(item))}
        >
          {isUpcoming
            ? t({ id: "scheduled.item.action.edit", message: "Edit" })
            : t({
                id: "scheduled.item.action.scheduleAgain",
                message: "Schedule again",
              })}
        </Button>
      </div>
    </Card>
  );
}
