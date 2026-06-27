import { t } from "@lingui/core/macro";

// NOTE (ERMAIN-411): currently unwired. The #5575 dead-state detection that fed
// this was reverted in favor of the manifest auto-pin prototype; the component
// is kept as the reusable, dismissible banner for the planned Mac "pin the
// add-in to follow this email" hint. Copy will be re-pointed when that lands.

export interface AddinContextLostBannerProps {
  /**
   * Re-read the current Office item. Wired to the mail-item provider's
   * `refresh()` — if the item came back, the banner clears itself; if it's
   * still gone, the provider re-arms the dead-state settle and the banner
   * stays.
   */
  onRetry: () => void;
  /** Hide the banner until the context is lost again. */
  onDismiss: () => void;
}

// Inline SVGs: the shared library barrel (@erato/frontend/library) only
// re-exports a handful of icons and pulling more would couple this add-in
// feature to a library rebuild. These three are decorative (aria-hidden); the
// surrounding text carries the meaning.

function WarningTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v4m0 4h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DismissIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M18 6 6 18M6 6l12 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Non-blocking recovery banner shown above the chat when the Outlook item
 * context was silently lost (office-js #5575 on new Outlook for Mac — see
 * `OutlookMailItemProvider`). The chat below stays fully usable; this only
 * explains the lost-context state and offers a retry. Dismissible.
 */
export function AddinContextLostBanner({
  onRetry,
  onDismiss,
}: AddinContextLostBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="addin-context-lost-banner"
      data-ui="addin-context-lost-banner"
      className="flex items-start gap-2 border-b border-theme-warning-border bg-theme-warning-bg px-4 py-2 text-theme-warning-fg"
    >
      <WarningTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xs font-semibold">
          {t({
            id: "officeAddin.contextLost.title",
            message: "Message context lost",
          })}
        </p>
        <p className="text-xs">
          {t({
            id: "officeAddin.contextLost.description",
            message:
              "Re-select the email, or close and reopen the add-in to continue.",
          })}
        </p>
        <div className="mt-0.5">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded border border-theme-warning-border px-2 py-0.5 text-xs font-medium text-theme-warning-fg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
          >
            <RetryIcon className="size-3" />
            {t({
              id: "officeAddin.contextLost.retry",
              message: "Retry",
            })}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t({
          id: "officeAddin.contextLost.dismiss",
          message: "Dismiss",
        })}
        className="shrink-0 rounded p-0.5 text-theme-warning-fg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
      >
        <DismissIcon className="size-4" />
      </button>
    </div>
  );
}
