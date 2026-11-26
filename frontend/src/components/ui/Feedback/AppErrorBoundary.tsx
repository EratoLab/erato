import { t } from "@lingui/core/macro";
import { Component } from "react";

import {
  isChunkLoadError,
  isChunkReloadPending,
  reloadOnceForChunkError,
} from "@/lib/chunkLoadRecovery";

import { Button } from "../Controls/Button";
import { ErrorIcon } from "../icons";
import { CopyErrorButton } from "./CopyErrorButton";

import type { ReactNode } from "react";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Shown while the page reloads to fetch a newer build. */
  reloadingFallback?: ReactNode;
}

type AppErrorBoundaryState =
  | { didCatch: false; error: null }
  | { didCatch: true; error: unknown };

function AppErrorFallback({ error }: { error: unknown }) {
  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-4 p-8"
      role="alert"
      data-testid="app-error"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--theme-error-bg)]">
        <ErrorIcon className="size-6 text-[var(--theme-error-fg)]" />
      </div>
      <h1 className="text-lg font-medium text-[var(--theme-fg-primary)]">
        {t({ id: "error.app.title", message: "Something went wrong" })}
      </h1>
      <p className="max-w-md text-center text-sm text-[var(--theme-fg-muted)]">
        {t({
          id: "error.app.body",
          message: "This page could not be shown. Reload the page to continue.",
        })}
      </p>
      <Button onClick={() => window.location.reload()} variant="primary">
        {t({ id: "error.app.reload", message: "Reload" })}
      </Button>
      <CopyErrorButton error={error} />
    </div>
  );
}

/**
 * The one catch above every page. A code file that fails to load after a
 * server update reloads the page once; anything else shows a plain message
 * with a reload button instead of a blank page.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { didCatch: false, error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    // Here rather than in componentDidCatch, so the first fallback render
    // already knows a reload is under way and does not flash the message.
    if (isChunkLoadError(error)) {
      reloadOnceForChunkError();
    }
    return { didCatch: true, error };
  }

  render() {
    if (!this.state.didCatch) {
      return this.props.children;
    }
    // A cancelled `vite:preloadError` leaves the lazy page without a module,
    // which throws here while the reload is already running.
    if (isChunkReloadPending()) {
      return this.props.reloadingFallback ?? null;
    }
    return <AppErrorFallback error={this.state.error} />;
  }
}
