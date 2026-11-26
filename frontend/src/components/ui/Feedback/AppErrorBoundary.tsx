import { i18n } from "@lingui/core";
import { Component } from "react";

import {
  catchError,
  ErrorPanel,
  NOTHING_CAUGHT,
  reloadAfterCatch,
  type CatchState,
} from "./ErrorPanel";

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
  state: CatchState = NOTHING_CAUGHT;

  static getDerivedStateFromError = catchError;

  componentDidCatch(error: unknown) {
    reloadAfterCatch(error, () => this.setState({ reloading: false }));
  }

  render() {
    if (!this.state.didCatch) {
      return this.props.children;
    }
    if (this.state.reloading) {
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
