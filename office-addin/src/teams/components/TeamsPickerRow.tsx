import {
  InteractiveContainer,
  MessageTimestamp,
} from "@erato/frontend/library";

import type { ReactNode } from "react";

const CHECKBOX_CLASS =
  "mt-1 size-4 shrink-0 rounded border-theme-border text-theme-fg-accent focus:ring-theme-focus disabled:cursor-not-allowed";

export interface TeamsPickerRowProps {
  checked: boolean;
  onToggle: () => void;
  /** Accessible name for the checkbox; the row body is not the control. */
  selectLabel: string;
  disabled?: boolean;
  title: ReactNode;
  subline?: ReactNode;
  /** Present only for rows that drill in; renders the title as a button. */
  onOpen?: () => void;
  openLabel?: string;
  /** Status line under the subline — why this row can't be ticked right now. */
  note?: ReactNode;
  createdAt?: string | null;
  /** Display name the initials avatar is derived from. */
  senderName?: string;
  /** Renders a channel glyph in the avatar slot instead of initials. */
  isChannel?: boolean;
}

/**
 * One selectable chat, message or search hit. The checkbox owns selection and
 * the title owns drill-in: making the whole row clickable would swallow the
 * checkbox's own click and its Space key.
 */
export function TeamsPickerRow({
  checked,
  onToggle,
  selectLabel,
  disabled = false,
  title,
  subline,
  onOpen,
  openLabel,
  note,
  createdAt,
  senderName,
  isChannel = false,
}: TeamsPickerRowProps) {
  const timestamp = createdAt ? new Date(createdAt) : null;

  return (
    <div className="theme-transition flex items-start gap-3 px-2 py-2 hover:bg-theme-bg-hover">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        aria-label={selectLabel}
        className={CHECKBOX_CLASS}
      />

      {isChannel ? (
        <ChannelGlyph />
      ) : (
        senderName !== undefined && <TeamsInitialsAvatar name={senderName} />
      )}

      <div className="min-w-0 flex-1">
        {onOpen ? (
          <InteractiveContainer
            onClick={onOpen}
            fullWidth={false}
            aria-label={openLabel}
            className="block max-w-full truncate text-left text-sm font-medium text-theme-fg-primary hover:underline"
          >
            {title}
          </InteractiveContainer>
        ) : (
          <div className="truncate text-sm font-medium text-theme-fg-primary">
            {title}
          </div>
        )}
        {subline !== undefined && (
          <div className="line-clamp-2 text-xs text-theme-fg-muted">
            {subline}
          </div>
        )}
        {note !== undefined && (
          <div
            className="mt-0.5 text-xs italic text-theme-fg-muted"
            role="status"
          >
            {note}
          </div>
        )}
      </div>

      {timestamp && !Number.isNaN(timestamp.getTime()) && (
        <MessageTimestamp
          createdAt={timestamp}
          displayStyle="relative"
          className="shrink-0 text-xs text-theme-fg-muted"
        />
      )}
    </div>
  );
}

/**
 * The library `Avatar` renders the signed-in erato profile and takes no name,
 * so an arbitrary Teams sender needs its own initials badge.
 */
/**
 * `#` is the cross-product convention for a channel, and it reads instantly in
 * the slot where a chat shows a face — no legend, no extra row width.
 */
function ChannelGlyph() {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded bg-theme-bg-accent text-sm font-semibold text-theme-fg-muted"
    >
      #
    </span>
  );
}

export function TeamsInitialsAvatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "?"
      : `${parts[0][0]}${parts[1]?.[0] ?? ""}`.toUpperCase();

  return (
    <div
      aria-hidden="true"
      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-theme-avatar-user-bg text-xs font-medium text-theme-avatar-user-fg"
    >
      {initials}
    </div>
  );
}

export function TeamsPickerRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 px-2 py-3">
      <div className="size-4 rounded bg-theme-bg-accent" />
      <div className="size-7 rounded-full bg-theme-bg-accent" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/3 rounded bg-theme-bg-accent" />
        <div className="h-3 w-2/3 rounded bg-theme-bg-accent" />
      </div>
      <div className="h-3 w-12 rounded bg-theme-bg-accent" />
    </div>
  );
}
