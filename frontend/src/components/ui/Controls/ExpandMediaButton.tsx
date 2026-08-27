import { t } from "@lingui/core/macro";
import clsx from "clsx";

import { CollapseDiagonalIcon, ExpandDiagonalIcon } from "../icons";

import type React from "react";

export interface ExpandMediaButtonProps {
  expanded: boolean;
  onToggle: () => void;
  /** Names the thing being expanded, e.g. a filename. */
  label: string;
  className?: string;
}

/**
 * Corner control offering the middle tier between a sized-down image and the
 * full preview: grow it in place, no chrome, reversible.
 *
 * Shared so an attached image and a generated one behave identically — the two
 * differ only in what they collapse back to. Revealed on hover or focus, and
 * pinned visible where there is no hover to reveal it with.
 */
export const ExpandMediaButton: React.FC<ExpandMediaButtonProps> = ({
  expanded,
  onToggle,
  label,
  className,
}) => (
  <button
    type="button"
    onClick={(event) => {
      // The image itself usually opens the full preview; growing it in place
      // must not also trigger that.
      event.stopPropagation();
      onToggle();
    }}
    aria-expanded={expanded}
    aria-label={expanded ? `${t`Collapse`} ${label}` : `${t`Expand`} ${label}`}
    className={clsx(
      "absolute -left-1 -top-1 z-10 inline-flex size-5 items-center justify-center rounded-full",
      "border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] text-[var(--theme-fg-muted)] shadow-sm",
      "hover:text-[var(--theme-fg-primary)]",
      "opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
      "[@media(hover:none)]:opacity-100",
      className,
    )}
  >
    {expanded ? (
      <CollapseDiagonalIcon className="size-3" />
    ) : (
      <ExpandDiagonalIcon className="size-3" />
    )}
  </button>
);
