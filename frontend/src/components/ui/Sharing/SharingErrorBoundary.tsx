import { t } from "@lingui/core/macro";
import { ErrorBoundary } from "react-error-boundary";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";

import type { ReactNode } from "react";

interface SharingErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

/**
 * Error fallback component for sharing dialog failures
 *
 * Displays user-friendly error message with retry option
 */
function SharingErrorFallback({
  error,
  resetErrorBoundary,
}: SharingErrorFallbackProps) {
  return (
    <div className="p-6">
      <Alert type="error">
        <div className="space-y-3">
          <p className="font-medium">
            {t({
              id: "sharing.error.unexpected",
              message: "Failed to load sharing dialog",
            })}
          </p>
          <p className="text-sm">
            {t({
              id: "sharing.error.tryAgain",
              message:
                "Please try again or contact support if the problem persists.",
            })}
          </p>
          {/* Show error details in development */}
          {process.env.NODE_ENV === "development" && (
            <details className="mt-2 text-xs">
              {/* eslint-disable-next-line lingui/no-unlocalized-strings */}
              <summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 overflow-auto rounded bg-red-50 p-2">
                {error.message}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={resetErrorBoundary}>
              {t({ id: "sharing.error.retry", message: "Try Again" })}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}

interface SharingErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

/**
 * Error boundary wrapper for sharing feature
 *
 * Prevents sharing errors from crashing the entire page.
 * Provides graceful degradation with retry functionality.
 *
 * @example
 * ```tsx
 * <SharingErrorBoundary onReset={() => setDialogOpen(false)}>
 *   <SharingDialog ... />
 * </SharingErrorBoundary>
 * ```
 */
export function SharingErrorBoundary({
  children,
  onReset,
}: SharingErrorBoundaryProps) {
  return (
    <ErrorBoundary
      FallbackComponent={SharingErrorFallback}
      onReset={onReset}
      onError={(error, errorInfo) => {
        // Log to console in development
        if (process.env.NODE_ENV === "development") {
          console.error("[SharingErrorBoundary] Error caught:", error);
          console.error("[SharingErrorBoundary] Error info:", errorInfo);
        }
        // In production, this would be sent to error tracking service (e.g., Sentry)
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
