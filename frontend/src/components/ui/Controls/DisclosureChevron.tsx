import clsx from "clsx";

import { ChevronRightIcon } from "../icons";

// Sized to the two disclosure families in use: sidebar/panel headers ("sm")
// and entity-card rows ("md").
const SIZE_STYLES = {
  sm: "size-3",
  md: "size-4",
} as const;

export type DisclosureChevronSize = keyof typeof SIZE_STYLES;

export interface DisclosureChevronProps {
  open: boolean;
  size?: DisclosureChevronSize;
  className?: string;
}

/**
 * The house disclosure affordance: a right-pointing chevron that rotates 90°
 * while open. Purely decorative — the owning toggle carries `aria-expanded`
 * (and the accessible name), so the icon stays out of the accessibility tree.
 */
export const DisclosureChevron = ({
  open,
  size = "sm",
  className,
}: DisclosureChevronProps) => (
  <ChevronRightIcon
    aria-hidden="true"
    className={clsx(
      "theme-transition shrink-0 text-theme-fg-muted",
      SIZE_STYLES[size],
      open ? "rotate-90" : "rotate-0",
      className,
    )}
  />
);
