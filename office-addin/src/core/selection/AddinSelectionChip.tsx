import { t } from "@lingui/core/macro";

import { ACTION_BUTTON_CLASS } from "../clientActions/clientActionButtonStyles";

const PREVIEW_LENGTH = 80;

export interface AddinSelectionChipProps {
  preview: string;
  metaLabel?: string;
  note?: string;
  /** False when Erato selected the passage itself: it is shown, but not sent until the user takes it over. */
  armed: boolean;
  onUse?: () => void;
  onDismiss: () => void;
  testId?: string;
}

function truncatePreview(preview: string): string {
  // Code points, so a cut never splits a surrogate pair into a replacement glyph.
  const characters = Array.from(preview);
  return characters.length > PREVIEW_LENGTH
    ? `${characters.slice(0, PREVIEW_LENGTH).join("")}...`
    : preview;
}

export function AddinSelectionChip({
  preview,
  metaLabel,
  note,
  armed,
  onUse,
  onDismiss,
  testId,
}: AddinSelectionChipProps) {
  return (
    <div className="mx-auto w-full max-w-[var(--theme-layout-chat-input-max-width)] px-2 pb-1 sm:px-4">
      <div
        className={`rounded-[var(--theme-radius-message)] ${armed ? "border" : "border border-dashed"} border-theme-border bg-theme-bg-secondary px-3 py-1.5 text-xs text-theme-fg-secondary`}
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0" aria-hidden="true">
            &#x2702;
          </span>
          <span className="min-w-0 truncate">
            &ldquo;{truncatePreview(preview)}&rdquo;
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto shrink-0 rounded-[var(--theme-radius-control)] p-0.5 hover:bg-theme-bg-tertiary"
            aria-label={t({
              id: "officeAddin.chatInput.dismissSelection",
              message: "Dismiss selection",
            })}
          >
            &#x2715;
          </button>
        </div>
        {(metaLabel || !armed) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
            {metaLabel && <span>{metaLabel}</span>}
            {!armed && (
              <span className="font-medium">
                {t({
                  id: "officeAddin.selection.shownByErato",
                  message: "Shown by Erato",
                })}
              </span>
            )}
          </div>
        )}
        {note && <p className="mt-0.5">{note}</p>}
        {!armed && onUse && (
          <button
            type="button"
            onClick={onUse}
            className={`mt-1 ${ACTION_BUTTON_CLASS}`}
          >
            {t({
              id: "officeAddin.selection.useThis",
              message: "Use this selection",
            })}
          </button>
        )}
      </div>
    </div>
  );
}
