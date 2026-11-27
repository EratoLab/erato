import { i18n } from "@lingui/core";
import { Component } from "react";

import {
  catchError,
  ErrorPanel,
  NOTHING_CAUGHT,
  recoverAfterCatch,
  type CatchState,
} from "./ErrorPanel";

import type { ReactNode } from "react";

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

/**
 * The one catch above every page: a plain message with a reload button
 * instead of a blank page. A code file that failed to load also checks for a
 * newer build, which reloads the page by itself.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  CatchState
> {
  state: CatchState = NOTHING_CAUGHT;

  static getDerivedStateFromError = catchError;

  componentDidCatch(error: unknown) {
    recoverAfterCatch(error);
  }

  render() {
    if (!this.state.didCatch) {
      return this.props.children;
    }
    // `i18n._` with the English text, not the `t` macro: production builds
    // strip the macro's text, and an Office pane can fail before its
    // translations load. No error report: it sits outside the providers.
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
      />
    );
  }
}
