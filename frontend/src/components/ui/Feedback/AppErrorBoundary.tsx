import { i18n } from "@lingui/core";
import { Component } from "react";

import { isChunkReloadPending } from "@/lib/chunkLoadRecovery";

import { catchError, ErrorPanel, type CatchState } from "./ErrorPanel";

import type { ReactNode } from "react";

export interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Shown while the page reloads to fetch a newer build. */
  reloadingFallback?: ReactNode;
}

/**
 * The one catch above every page. A code file that fails to load after a
 * server update reloads the page once; anything else shows a plain message
 * with a reload button instead of a blank page.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  CatchState
> {
  state: CatchState = { didCatch: false, error: null };

  static getDerivedStateFromError = catchError;

  render() {
    if (!this.state.didCatch) {
      return this.props.children;
    }
    // A cancelled `vite:preloadError` leaves the lazy page without a module,
    // which throws here while the reload is already running.
    if (isChunkReloadPending()) {
      return this.props.reloadingFallback ?? null;
    }
    // `i18n._` with the English text, not the `t` macro: production builds
    // strip the macro's text, and an Office pane can fail before its
    // translations load.
    return (
      <ErrorPanel
        title={i18n._({
          id: "error.app.title",
          message: "Something went wrong",
        })}
        body={i18n._({
          id: "error.app.body",
          message: "This page could not be shown. Reload to continue.",
        })}
        actionLabel={i18n._({ id: "error.app.reload", message: "Reload" })}
        onAction={() => window.location.reload()}
        error={this.state.error}
      />
    );
  }
}
