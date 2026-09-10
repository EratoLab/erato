/**
 * Styles for the file preview elements. A chip's own anatomy is the attachment
 * tile's — one component's classes, rather than a shared string every caller
 * could reassemble differently — so what is here belongs to the surfaces the
 * tile does not draw.
 */
export const FILE_PREVIEW_STYLES = {
  progress: {
    container:
      "w-full h-1 bg-[var(--theme-bg-primary)] rounded-full overflow-hidden",
    bar: "h-full bg-[var(--theme-action-primary-bg)] transition-all duration-300 ease-in-out",
  },
  group: {
    header: "mb-2 flex min-w-0 items-start gap-2",
    title: "truncate text-sm font-medium text-[var(--theme-fg-secondary)]",
    meta: "text-xs text-[var(--theme-fg-muted)]",
    toggleButton: "text-xs",
    moreButton: "self-start px-0 text-xs text-[var(--theme-fg-muted)]",
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
  // Focus border + accent fill is the app's existing "active drop target"
  // language, and it resolves per theme — so no `dark:` variant is needed.
  active: "border-[var(--theme-border-focus)] bg-[var(--theme-bg-accent)]",
  disabled: "opacity-50 cursor-not-allowed",
  text: "text-sm text-[var(--theme-fg-secondary)]",
  icon: "size-8 mx-auto mb-2 text-[var(--theme-fg-muted)]",
};
