import { useEffect } from "react";

import {
  isChunkLoadError,
  recoverFromChunkLoadFailure,
} from "@/lib/chunkLoadRecovery";
import { reportDrawnWhenSettled } from "@/lib/shellStartScreen";

import { Button } from "../Controls/Button";
import { ErrorIcon } from "../icons";
import { CopyErrorButton } from "./CopyErrorButton";

export interface ErrorPanelProps {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  /** Offers to copy an error report; needs the feature config provider. */
  error?: unknown;
}

/** What a catch shows in place of the part that failed. */
export function ErrorPanel({
  title,
  body,
  actionLabel,
  onAction,
  error,
}: ErrorPanelProps) {
  // A host app covering the start waits for this before it shows the page.
  useEffect(() => reportDrawnWhenSettled(), []);
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
      {error !== undefined && <CopyErrorButton error={error} />}
    </div>
  );
}

export interface CatchState {
  didCatch: boolean;
  error: unknown;
}

export const NOTHING_CAUGHT: CatchState = { didCatch: false, error: null };

/** `getDerivedStateFromError` of the catches; free of side effects. */
export function catchError(error: unknown): CatchState {
  return { didCatch: true, error };
}

/**
 * `componentDidCatch` of the catches: a code file that failed to load checks
 * for a newer build, which reloads the page when nothing is in progress.
 */
export function recoverAfterCatch(error: unknown): void {
  if (isChunkLoadError(error)) void recoverFromChunkLoadFailure();
}
