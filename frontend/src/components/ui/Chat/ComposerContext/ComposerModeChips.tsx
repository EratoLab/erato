import { useId } from "react";

import { CloseIcon } from "@/components/ui/icons";

import { ComposerContextGlyph } from "./composerContextIcons";
import { useLiveAnnouncement } from "./useLiveAnnouncement";

import type { ComposerMode } from "./types";

export interface ComposerModeChipsProps {
  modes: ComposerMode[];
  /** Takes focus after an end, since the chip leaves with its button. */
  onFocusComposer?: () => void;
}

const ModeChip = ({
  mode,
  onEnd,
}: {
  mode: ComposerMode;
  onEnd: (mode: ComposerMode) => void;
}) => {
  const descriptionId = useId();
  return (
    <div
      role="group"
      aria-label={mode.label}
      data-ui="composer-mode-chip"
      data-mode-id={mode.id}
      data-locked={mode.locked ? "true" : undefined}
      title={mode.description}
      className="ms-[var(--theme-spacing-control-gap)] inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-[var(--theme-radius-control)] border border-[var(--theme-border-attachment)] bg-theme-bg-primary pl-2 pr-0.5 text-xs text-theme-fg-secondary"
    >
      <ComposerContextGlyph icon={mode.icon} state="included" tone="neutral" />
      <span data-ui="composer-mode-chip-label" className="truncate">
        {mode.label}
      </span>
      <button
        type="button"
        data-ui="composer-mode-end"
        aria-label={mode.endLabel}
        aria-describedby={mode.description ? descriptionId : undefined}
        title={mode.locked && mode.lockReason ? mode.lockReason : mode.endLabel}
        disabled={mode.locked}
        onClick={() => onEnd(mode)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--theme-radius-control)] text-theme-fg-muted hover:bg-theme-bg-hover hover:text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <span aria-hidden="true" className="inline-flex">
          <CloseIcon className="size-3.5" />
        </span>
      </button>
      {mode.description ? (
        <span id={descriptionId} className="sr-only">
          {mode.description}
        </span>
      ) : null}
    </div>
  );
};

/**
 * Modes the next send runs in, such as scheduling, each with one end button.
 * The live region stays mounted while the host passes modes, even none, so
 * the announcement after the last mode ends is still read.
 */
export const ComposerModeChips = ({
  modes,
  onFocusComposer,
}: ComposerModeChipsProps) => {
  const [announcement, announce] = useLiveAnnouncement();
  const end = (mode: ComposerMode) => {
    mode.onEnd();
    if (mode.endedAnnouncement) announce(mode.endedAnnouncement);
    onFocusComposer?.();
  };
  return (
    <>
      {modes.map((mode) => (
        <ModeChip key={mode.id} mode={mode} onEnd={end} />
      ))}
      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-ui="composer-mode-live"
      >
        {announcement}
      </span>
    </>
  );
};
