/**
 * How an old and a new value read wherever a card shows old → new: the
 * theme's diff colours, so they read as removed and added in light and dark.
 */
export const OLD_VALUE_CLASS =
  "rounded bg-[var(--theme-diff-removed-bg)] px-1 text-[var(--theme-diff-removed-fg)] line-through";
export const NEW_VALUE_CLASS =
  "rounded bg-[var(--theme-diff-added-bg)] px-1 text-[var(--theme-diff-added-fg)]";
/** For a block of text, where a filled background would be a wall of colour. */
export const OLD_TEXT_CLASS =
  "text-[var(--theme-diff-removed-fg)] line-through";
export const NEW_TEXT_CLASS = "text-[var(--theme-diff-added-fg)]";

/**
 * A card's headline is the one line at this size; under a caller's own
 * heading it reads as that heading's row did before.
 */
export const headlineClass = (lead: boolean, belowHeading: boolean) =>
  belowHeading
    ? "text-sm font-medium"
    : lead
      ? "text-base font-semibold"
      : "text-sm font-semibold";
