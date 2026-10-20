import { useLayoutEffect, useRef } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { WarningCircleIcon, WarningIcon } from "@/components/ui/icons";

import type { ComposerNotice } from "./types";

interface ComposerNoticeViewProps {
  notice: ComposerNotice | null;
  /**
   * Called when the notice changes or leaves while focus was on one of its
   * buttons, which the change took away; the composer's textarea.
   */
  onFocusLost?: () => void;
}

/**
 * The chips' own warning and error marks, so a mark means one thing across
 * the composer; the themed error mark is an (x), which beside the dismiss
 * (x) reads as a second close button. Boxed at the alert's icon size, since
 * an inline spinner sits on the text baseline below the first line.
 */
const noticeIcon = (notice: ComposerNotice) => {
  const glyph = notice.busy ? (
    <SpinnerIcon size="md" aria-hidden="true" />
  ) : notice.tone === "error" ? (
    <WarningCircleIcon className="size-5" />
  ) : notice.tone === "warning" ? (
    <WarningIcon className="size-5" />
  ) : null;
  return glyph ? (
    <span
      aria-hidden="true"
      data-ui="composer-notice-icon"
      className="flex size-5 items-center justify-center"
    >
      {glyph}
    </span>
  ) : undefined;
};

/**
 * A one-off send prompt above the chips. Both live regions stay mounted while
 * the host opts in, even with no notice, because a region that arrives
 * already holding its text, or changes its role with it, is often not read.
 * Errors speak through the assertive one. Empty, the wrapper leaves the flow
 * so the shell's gap does not grow.
 */
export const ComposerNoticeView = ({
  notice,
  onFocusLost,
}: ComposerNoticeViewProps) => {
  const focusInsideRef = useRef(false);
  // A pressed action that settles the prompt removes the button under focus,
  // which leaves no blur behind and focus on the page.
  useLayoutEffect(() => {
    if (!focusInsideRef.current) {
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) {
      focusInsideRef.current = false;
      onFocusLost?.();
    }
  }, [notice, onFocusLost]);
  const content = notice ? (
    <Alert
      key={notice.id}
      type={notice.tone}
      role="none"
      geometryVariant="message"
      icon={noticeIcon(notice)}
      dismissible={Boolean(notice.onDismiss)}
      onDismiss={notice.onDismiss}
    >
      <div className="flex flex-col gap-2">
        <span>
          {notice.text}
          {notice.progressLabel ? (
            <span
              aria-hidden="true"
              data-ui="composer-notice-progress"
              className="ml-1.5 whitespace-nowrap tabular-nums"
            >
              {notice.progressLabel}
            </span>
          ) : null}
        </span>
        {notice.actions && notice.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {notice.actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant="secondary"
                onClick={action.onSelect}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </Alert>
  ) : null;
  const assertive = notice?.tone === "error";
  return (
    <div
      data-ui="composer-notice"
      data-tone={notice?.tone}
      className={notice ? undefined : "absolute"}
      onFocus={() => {
        focusInsideRef.current = true;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusInsideRef.current = false;
        }
      }}
    >
      <div role="status" aria-atomic="true" data-ui="composer-notice-polite">
        {assertive ? null : content}
      </div>
      <div role="alert" aria-atomic="true" data-ui="composer-notice-assertive">
        {assertive ? content : null}
      </div>
    </div>
  );
};
