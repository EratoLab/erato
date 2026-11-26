import {
  isChunkLoadError,
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

export type CatchState =
  | { didCatch: false; error: null }
  | { didCatch: true; error: unknown };

/**
 * `getDerivedStateFromError` of the catches. A code file that failed to load
 * starts the reload here rather than in componentDidCatch, so the first
 * render already knows and does not flash an error.
 */
export function catchError(error: unknown): CatchState {
  if (isChunkLoadError(error)) {
    reloadOnceForChunkError();
  }
  return { didCatch: true, error };
}
