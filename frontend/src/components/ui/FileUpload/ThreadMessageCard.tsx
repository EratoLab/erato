import { t } from "@lingui/core/macro";
import clsx from "clsx";
import { useId, useState } from "react";

import { Card } from "../Container/Card";
import { ChevronDownIcon, ChevronRightIcon } from "../icons";

import type React from "react";

const ThreadMessageHeaderText: React.FC<{
  label: string;
  sublabel?: string;
  metaLabel?: string;
}> = ({ label, sublabel, metaLabel }) => {
  // Meta stays in the text stack (like the group header's "N messages")
  // instead of floating right-aligned on its own.
  const secondLine = [sublabel, metaLabel].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0 flex-1">
      <p
        className="truncate text-sm font-medium text-theme-fg-primary"
        title={label}
      >
        {label}
      </p>
      {secondLine && (
        <p className="truncate text-xs text-theme-fg-muted" title={secondLine}>
          {secondLine}
        </p>
      )}
    </div>
  );
};

export interface ThreadMessageCardProps {
  label: string;
  sublabel?: string;
  /**
   * The rows the card discloses. The card never builds them, so a host that
   * shows something other than attachment rows under a message — a preview,
   * a summary — reuses the frame as it stands.
   */
  children?: React.ReactNode;
  /** Drives the header meta and whether there is anything to disclose. */
  attachmentCount: number;
  /** Whether the message is staged for upload. Unselected reads as dimmed. */
  selected?: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * One message of an email thread, inside the attachment group frame that
 * stages the thread. It is a nested card: its corner comes from the group
 * frame, so the two stay concentric at any theme radius, and the attachment
 * chips inside derive from it in turn.
 */
export const ThreadMessageCard: React.FC<ThreadMessageCardProps> = ({
  label,
  sublabel,
  children,
  attachmentCount,
  selected = true,
  onToggle,
  disabled = false,
  defaultCollapsed = true,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const panelId = useId();
  const hasAttachments = attachmentCount > 0;
  return (
    <Card
      variant="expandable"
      nested
      size="xs"
      tone="muted"
      unmountOnCollapse
      expanded={!collapsed}
      bodyId={panelId}
      data-ui="thread-message-card"
      // The inset is painted on the frame, not on the body: the body's left
      // gutter is a column the header's controls stand in rather than an
      // inset, so the body cannot carry both.
      className={clsx(
        "thread-message-card-geometry p-[var(--card-inset)]",
        !selected && "opacity-60",
      )}
      // pl-6 is the column the header's disclosure and selection controls
      // stand in, so the rows line up under the message label.
      bodyClassName="mt-2 flex flex-col gap-1 p-0 pl-6"
      header={
        <div className="flex items-center gap-2">
          {/* Fixed columns across tree levels: disclosure, selection, text. */}
          {hasAttachments ? (
            // Only render the chevron when there's something to expand —
            // an empty thread message has no attachments to show, so a
            // disclosure toggle would dangle without any payload.
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="inline-flex size-4 shrink-0 items-center justify-center text-theme-fg-muted"
              aria-expanded={!collapsed}
              aria-controls={panelId}
              aria-label={`${t({ id: "chat.attachments.toggle", message: "Toggle attachments" })} ${label}`}
            >
              {collapsed ? (
                <ChevronRightIcon className="size-4" />
              ) : (
                <ChevronDownIcon className="size-4" />
              )}
            </button>
          ) : (
            <span className="size-4 shrink-0" aria-hidden="true" />
          )}
          {onToggle && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              disabled={disabled}
              className="size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed"
              aria-label={`${t({ id: "chat.attachments.include_message", message: "Include message" })} ${label}`}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          {hasAttachments ? (
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              tabIndex={-1}
            >
              <ThreadMessageHeaderText
                label={label}
                sublabel={sublabel}
                metaLabel={
                  attachmentCount === 1
                    ? t`1 file`
                    : t`${attachmentCount} files`
                }
              />
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <ThreadMessageHeaderText label={label} sublabel={sublabel} />
            </div>
          )}
        </div>
      }
    >
      {hasAttachments ? children : null}
    </Card>
  );
};
