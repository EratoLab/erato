import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";
import { WarningCircleIcon, WarningIcon } from "@/components/ui/icons";

import type { ComposerNotice } from "./types";

interface ComposerNoticeViewProps {
  notice: ComposerNotice | null;
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
 * A one-off send prompt above the chips. The wrapper stays mounted while the
 * host opts in, even with no notice, because a live region that arrives
 * already holding its text is often not read; empty, it leaves the flow so
 * the shell's gap does not grow.
 */
export const ComposerNoticeView = ({ notice }: ComposerNoticeViewProps) => (
  <div
    data-ui="composer-notice"
    data-tone={notice?.tone}
    role={notice?.tone === "error" ? "alert" : "status"}
    aria-atomic="true"
    className="empty:absolute"
  >
    {notice ? (
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
          <span>{notice.text}</span>
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
    ) : null}
  </div>
);
