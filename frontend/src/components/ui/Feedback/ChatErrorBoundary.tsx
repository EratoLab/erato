"use client";

import { t } from "@lingui/core/macro";
import { ErrorBoundary } from "react-error-boundary";

import { Button } from "../Controls/Button";
import { ErrorIcon } from "../icons";

import type React from "react";

export interface ChatErrorBoundaryProps {
  children: React.ReactNode;
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
      <h3 className="text-lg font-medium text-[var(--theme-fg-strong)]">
        {t`Chat Error`}
      </h3>
      <p className="max-w-md text-center text-sm text-[var(--theme-fg-muted)]">
        {error.message ||
          t`Something went wrong while loading the chat interface.`}
      </p>
      <Button onClick={resetErrorBoundary} variant="primary" className="mt-4">
        {t`Try Again`}
      </Button>
    </div>
  );
};

/**
 * Error boundary component specifically for chat components
 *
 * This component catches errors in the chat interface and displays a
 * friendly error message with a retry button.
 */
export function ChatErrorBoundary({
  children,
  onReset,
}: ChatErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={ChatErrorFallback}
      onReset={() => {
        // Optional callback when the error boundary is reset
        onReset?.();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
