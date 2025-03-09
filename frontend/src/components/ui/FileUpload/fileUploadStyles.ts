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
  disabled: "opacity-50 cursor-not-allowed",
};

/**
 * Styles for the file preview elements
 */
export const FILE_PREVIEW_STYLES = {
  container:
    "flex items-center gap-2 p-2 rounded-md bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)]",
  icon: "size-5 text-[var(--theme-fg-muted)]",
  name: "text-sm font-medium text-[var(--theme-fg-primary)] truncate max-w-[150px]",
  size: "text-xs text-[var(--theme-fg-muted)]",
  closeButton:
    "text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg-primary)] p-1 rounded-full",
  progress: {
    container:
      "w-full h-1 bg-[var(--theme-bg-primary)] rounded-full overflow-hidden",
    bar: "h-full bg-blue-500 transition-all duration-300 ease-in-out",
  },
};

/**
 * Styles for the drop zone
 */
export const DROP_ZONE_STYLES = {
  container:
    "border-2 border-dashed rounded-lg p-4 text-center transition-colors",
  default:
    "border-[var(--theme-border)] hover:border-[var(--theme-border-focus)]",
  active: "border-blue-500 bg-blue-50 dark:bg-blue-900/20",
  disabled: "opacity-50 cursor-not-allowed",
  text: "text-sm text-[var(--theme-fg-secondary)]",
  icon: "size-8 mx-auto mb-2 text-[var(--theme-fg-muted)]",
};
