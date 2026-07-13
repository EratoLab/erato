import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useErrorReportFeature } from "@/providers/FeatureConfigProvider";
import { renderFrontendErrorReport } from "@/utils/errorReport";

import { Button } from "../Controls/Button";
import { CheckIcon, CopyIcon } from "../icons";

import type { FrontendErrorReportOptions } from "@/utils/errorReport";

export interface CopyErrorButtonProps {
  error?: unknown;
  report?: string | null;
  reportOptions?: Omit<
    FrontendErrorReportOptions,
    "template" | "environment" | "platform"
  >;
  className?: string;
  iconOnly?: boolean;
}

export function CopyErrorButton({
  error,
  report,
  reportOptions,
  className,
  iconOnly = false,
}: CopyErrorButtonProps) {
  const config = useErrorReportFeature();
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const errorReport = useMemo(
    () =>
      report ??
      (error === undefined
        ? null
        : renderFrontendErrorReport(error, {
            ...reportOptions,
            template: config.errorReportTemplate,
            environment: config.environment,
            platform: config.platform,
          })),
    [config, error, report, reportOptions],
  );

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    if (!errorReport) {
      return;
    }

    await navigator.clipboard.writeText(errorReport);
    setIsCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setIsCopied(false), 2000);
  }, [errorReport]);

  if (!config.showCopyErrorReport || !errorReport) {
    return null;
  }

  return (
    <Button
      variant={iconOnly ? "icon-only" : "secondary"}
      size="sm"
      className={className}
      icon={
        isCopied ? (
          <CheckIcon className="size-4" />
        ) : (
          <CopyIcon className="size-4" />
        )
      }
      onClick={() => void handleCopy()}
      aria-label={t({
        id: "chat.message.error.copy_report.aria",
        message: "Copy error report",
      })}
      title={
        iconOnly
          ? t({
              id: "chat.message.error.copy_report",
              message: "Copy error report",
            })
          : undefined
      }
    >
      {!iconOnly &&
        (isCopied
          ? t({
              id: "chat.message.error.copy_report.copied",
              message: "Copied",
            })
          : t({
              id: "chat.message.error.copy_report",
              message: "Copy error report",
            }))}
    </Button>
  );
}
