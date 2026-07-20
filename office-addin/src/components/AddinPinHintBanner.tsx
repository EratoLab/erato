import { t } from "@lingui/core/macro";

export interface AddinPinHintBannerProps {
  /** Hide the hint permanently (the user has acknowledged it). */
  onDismiss: () => void;
}

// Inline SVGs: the shared library barrel (@erato/frontend/library) only
// re-exports a handful of icons; pulling more would couple this to a library
// rebuild. Both are decorative (aria-hidden) — the text carries the meaning.

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 17v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
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
 * Non-blocking hint nudging the user to pin the add-in. Shown only on Outlook
 * for Mac desktop, and only until the host delivers its first item-change
 * event (proof the pane is effectively pinned/tracking) or the user dismisses
 * it — see the gating in `AddinChat`.
 *
 * Background: on new Outlook for Mac an unpinned task pane stays open but never
 * receives `ItemChanged`, so the chat freezes on the message it was opened
 * from. Pinning is the only thing that makes it follow navigation, and there's
 * no API to pin or to detect the pin state (office-js #1691, #4187) — so the
 * best we can do is teach the user to pin. Dismissible.
 */
export function AddinPinHintBanner({ onDismiss }: AddinPinHintBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="addin-pin-hint-banner"
      data-ui="addin-pin-hint-banner"
      className="flex items-start gap-2 border-b border-theme-warning-border bg-theme-warning-bg px-4 py-2 text-theme-warning-fg"
    >
      <PinIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-xs font-semibold">
          {t({
            id: "officeAddin.pinHint.title",
            message: "Pin to follow your mail",
          })}
        </p>
        <p className="text-xs">
          {t({
            id: "officeAddin.pinHint.description",
            message:
              "Until it's pinned, this add-in stays on the message you opened it from. Select the pin icon to keep it in sync as you read.",
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t({
          id: "officeAddin.pinHint.dismiss",
          message: "Dismiss",
        })}
        className="shrink-0 rounded-[var(--theme-radius-control)] p-0.5 text-theme-warning-fg transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
      >
        <DismissIcon className="size-4" />
      </button>
    </div>
  );
}
