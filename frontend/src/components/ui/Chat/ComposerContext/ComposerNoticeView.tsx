import { Button } from "@/components/ui/Controls/Button";
import { Alert } from "@/components/ui/Feedback/Alert";
import { SpinnerIcon } from "@/components/ui/Feedback/SpinnerIcon";

import type { ComposerNotice } from "./types";

interface ComposerNoticeViewProps {
  notice: ComposerNotice | null;
}

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
        icon={
          notice.busy ? <SpinnerIcon size="sm" aria-hidden="true" /> : undefined
        }
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
