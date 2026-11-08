import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useState } from "react";

import { DropdownMenu } from "../Controls/DropdownMenu";
import {
  BellIcon,
  ChatBubbleIcon,
  ChevronDownIcon,
  PlayIcon,
  PlusIcon,
} from "../icons";

export interface ScheduledNewMenuProps {
  onNewReminder: () => void;
  /** Omitted until a chat can open with the schedule facet (ERMAIN-1143). */
  onCreateWithChat?: () => void;
  /**
   * Set at the limit of upcoming items: Reminder is disabled and says why
   * instead of opening a form the API would refuse.
   */
  limitNotice?: string | null;
}

/**
 * The page's one primary action. Every item type is listed, including the
 * ones that are not available yet, so the menu does not change shape when
 * they arrive.
 */
export function ScheduledNewMenu({
  onNewReminder,
  onCreateWithChat,
  limitNotice,
}: ScheduledNewMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const newLabel = t({ id: "scheduled.new.trigger", message: "New" });

  return (
    <DropdownMenu
      align="left"
      matchContentWidth
      triggerButtonVariant="primary"
      triggerAriaLabel={newLabel}
      onOpenChange={setIsOpen}
      triggerIcon={
        <>
          <PlusIcon className="size-4" />
          <span>{newLabel}</span>
          <ChevronDownIcon
            className={clsx(
              "size-3 transition-transform motion-reduce:transition-none",
              isOpen && "rotate-180",
            )}
          />
        </>
      }
      items={[
        {
          id: "reminder",
          label: t({ id: "scheduled.new.reminder", message: "Reminder" }),
          description:
            limitNotice ??
            t({
              id: "scheduled.new.reminder.description",
              message: "Get a message at a time you choose",
            }),
          icon: <BellIcon className="size-4" />,
          onClick: onNewReminder,
          disabled: Boolean(limitNotice),
          closesImmediately: true,
        },
        {
          id: "scheduled-task",
          label: t({
            id: "scheduled.new.scheduledTask",
            message: "Scheduled task",
          }),
          description: t({
            id: "scheduled.new.scheduledTask.description",
            message: "Erato runs a prompt or check for you. Coming later",
          }),
          icon: <PlayIcon className="size-4" />,
          onClick: () => undefined,
          disabled: true,
        },
        {
          id: "create-with-chat",
          sectionHeader: t({
            id: "scheduled.new.section.inChat",
            message: "In a chat",
          }),
          label: t({
            id: "scheduled.new.createWithChat",
            message: "Create with chat",
          }),
          description: t({
            id: "scheduled.new.createWithChat.description",
            message: "Describe it and Erato sets it up",
          }),
          icon: <ChatBubbleIcon className="size-4" />,
          onClick: () => onCreateWithChat?.(),
          disabled: onCreateWithChat == null,
          closesImmediately: true,
        },
      ]}
    />
  );
}
