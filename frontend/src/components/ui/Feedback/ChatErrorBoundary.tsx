"use client";

import { t } from "@lingui/core/macro";
import { Component } from "react";

import { isChunkLoadError } from "@/lib/chunkLoadRecovery";
import { plainErrorMessage } from "@/utils/plainErrorMessage";

import {
  catchError,
  ErrorPanel,
  NOTHING_CAUGHT,
  recoverAfterCatch,
  type CatchState,
} from "./ErrorPanel";

import type { ReactNode } from "react";

export interface ChatErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

/**
 * Error fallback component to display when chat encounters an error
 */
const ChatErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
  <ErrorPanel
    title={t`Chat Error`}
    body={
      plainErrorMessage(error) ??
      t`Something went wrong while loading the chat interface.`
    }
    actionLabel={t`Try Again`}
    // Trying again cannot bring back a code file the server no longer has.
    onAction={
      isChunkLoadError(error)
        ? () => window.location.reload()
        : resetErrorBoundary
    }
    error={error}
  />
);

/**
 * Error boundary component specifically for chat components
 *
 * This component catches errors in the chat interface and displays a
 * friendly error message with a retry button.
 */
// Not react-error-boundary: it provides a new context value on every render,
// and a pane re-renders this boundary on every streamed token, so React
// searched the whole message list below it for readers on each token.
export class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  CatchState
> {
  state: CatchState = NOTHING_CAUGHT;

  static getDerivedStateFromError = catchError;

  componentDidCatch(error: unknown) {
    recoverAfterCatch(error);
  }

  private readonly resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState(NOTHING_CAUGHT);
  };

  render() {
    if (this.state.didCatch) {
      return (
        <ChatErrorFallback
          error={this.state.error as Error}
          resetErrorBoundary={this.resetErrorBoundary}
        />
      );
    }
    return this.props.children;
  }
}
