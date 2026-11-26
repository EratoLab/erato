import {
  isChunkLoadError,
  isChunkReloadPending,
  reloadOnceForChunkError,
} from "@/lib/chunkLoadRecovery";

import { Button } from "../Controls/Button";
import { ErrorIcon } from "../icons";
import { CopyErrorButton } from "./CopyErrorButton";

export interface ErrorPanelProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  error: unknown;
}

/** What a catch shows in place of the part that failed. */
export function ErrorPanel({
  title,
  body,
  actionLabel,
  onAction,
  error,
}: ErrorPanelProps) {
  return (
    <div
      className="flex size-full flex-col items-center justify-center space-y-4 p-8"
      role="alert"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--theme-error-bg)]">
        <ErrorIcon className="size-6 text-[var(--theme-error-fg)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--theme-fg-primary)]">
        {title}
      </h3>
      <p className="max-w-md text-center text-sm text-[var(--theme-fg-muted)]">
        {body}
      </p>
      <Button onClick={onAction} variant="primary" className="mt-4">
        {actionLabel}
      </Button>
      <CopyErrorButton error={error} />
    </div>
  );
}

export interface CatchState {
  didCatch: boolean;
  error: unknown;
  /** The page is reloading for a newer build; show no error meanwhile. */
  reloading: boolean;
}

export const NOTHING_CAUGHT: CatchState = {
  didCatch: false,
  error: null,
  reloading: false,
};

/** `getDerivedStateFromError` of the catches; free of side effects. */
export function catchError(error: unknown): CatchState {
  return {
    didCatch: true,
    error,
    // A cancelled `vite:preloadError` leaves a lazy part without its module,
    // which throws a technical error while the reload already runs.
    reloading: isChunkLoadError(error) || isChunkReloadPending(),
  };
}

/**
 * `componentDidCatch` of the catches: a code file that failed to load reloads
 * the page once; when the guard refuses, the error shows after all.
 */
export function reloadAfterCatch(error: unknown, showError: () => void): void {
  if (isChunkLoadError(error) && !reloadOnceForChunkError()) showError();
}
