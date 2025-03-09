/**
 * Shared styles for file upload components
 */
export const BUTTON_STYLES = {
  base: "inline-flex items-center rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus-ring)] theme-transition",
  iconOnly: "justify-center p-1.5",
  withLabel: "gap-2 px-4 py-2",
  default:
    "bg-[var(--theme-bg-secondary)] text-[var(--theme-fg-secondary)] hover:bg-[var(--theme-bg-hover)]",
  hover: "bg-blue-100 text-[var(--theme-fg-accent)]",
  loading:
    "inline-flex items-center justify-center rounded-md bg-[var(--theme-bg-secondary)] p-1.5 text-[var(--theme-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-focus-ring)]",
  error:
    "inline-flex items-center justify-center rounded-md bg-[var(--theme-error-bg)] p-1.5 text-[var(--theme-error-fg)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-error-border)]",
};
