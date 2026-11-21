"use client";

import { t } from "@lingui/core/macro";
import { Component } from "react";

import { Button } from "../Controls/Button";
import { ErrorIcon } from "../icons";
import { CopyErrorButton } from "./CopyErrorButton";

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
const ChatErrorFallback = ({ error, resetErrorBoundary }: FallbackProps) => {
  return (
    <div className="flex size-full flex-col items-center justify-center space-y-4 p-8">
      <div className="flex size-12 items-center justify-center rounded-full bg-[var(--theme-error-bg)]">
        <ErrorIcon className="size-6 text-[var(--theme-error-fg)]" />
      </div>
      <h3 className="text-lg font-medium text-[var(--theme-fg-primary)]">
        {t`Chat Error`}
      </h3>
      <p className="max-w-md text-center text-sm text-[var(--theme-fg-muted)]">
        {error.message ||
          t`Something went wrong while loading the chat interface.`}
      </p>
      <Button onClick={resetErrorBoundary} variant="primary" className="mt-4">
        {t`Try Again`}
      </Button>
      <CopyErrorButton error={error} />
    </div>
  );
};

type ChatErrorBoundaryState =
  | { didCatch: false; error: null }
  | { didCatch: true; error: unknown };

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
  ChatErrorBoundaryState
> {
  state: ChatErrorBoundaryState = { didCatch: false, error: null };

  static getDerivedStateFromError(error: unknown): ChatErrorBoundaryState {
    return { didCatch: true, error };
  }

  private readonly resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState({ didCatch: false, error: null });
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
