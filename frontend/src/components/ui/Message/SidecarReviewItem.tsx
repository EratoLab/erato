import { t } from "@lingui/core/macro";
import { useState } from "react";

import { requestClientOperationSweep } from "@/lib/clientOperations/handlers";
import { reopenSidecarReview } from "@/lib/desktopSidecar/sidecarJobs";
import { askForReviewAgain } from "@/lib/desktopSidecar/sidecarReviewLinks";
import { sidecarToolLabel } from "@/lib/desktopSidecar/toolLabels";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { APPROVAL_CARD_SHELL_CLASS } from "./ApprovalDecisionActions";
import { Button } from "../Controls/Button";

import type { SidecarReviewLink } from "@/lib/desktopSidecar/sidecarReviewLinks";

/**
 * A call of this turn that waits for its review in the Erato desktop app, in
 * the approval slot. The decision is made only in the app's window; this
 * shows that window again, or, once the review has ended, asks again.
 */
export const SidecarReviewItem = ({
  linkKey,
  link,
  toolName,
}: {
  linkKey: string;
  link: SidecarReviewLink;
  /** The waiting call's tool, to say what is waiting. */
  toolName: string | undefined;
}) => {
  const { client } = useDesktopSidecar();
  const [openFailed, setOpenFailed] = useState(false);
  const canReachApp = client?.supports("jobs.review.v1") === true;
  const isEnded = link.state === "ended";
  return (
    <div
      data-testid="sidecar-review-item"
      data-review-state={link.state}
      className={`${APPROVAL_CARD_SHELL_CLASS} space-y-2`}
    >
      <div>
        <p className="text-sm font-medium text-theme-fg-primary">
          {isEnded
            ? t({
                id: "sidecarReview.ended.title",
                message: "This review has ended",
              })
            : link.state === "asking"
              ? t({
                  id: "sidecarReview.asking.title",
                  message: "Asking again in the Erato desktop app",
                })
              : t({
                  id: "sidecarReview.open.title",
                  message: "Waiting for your review in the Erato desktop app",
                })}
        </p>
        {toolName && (
          <p className="text-sm text-theme-fg-secondary">
            {sidecarToolLabel(toolName)}
          </p>
        )}
        <p className="text-xs text-theme-fg-muted">
          {isEnded
            ? t({
                id: "sidecarReview.ended.description",
                message:
                  "Nothing was shared. A review ends one hour after it starts.",
              })
            : t({
                id: "sidecarReview.open.description",
                message: "A review ends one hour after it starts.",
              })}
        </p>
      </div>
      {link.state === "open" && (
        <Button
          variant="secondary"
          size="sm"
          disabled={!canReachApp}
          data-testid="sidecar-review-open"
          onClick={() => {
            if (!client) return;
            setOpenFailed(false);
            reopenSidecarReview(client, linkKey).catch(() => {
              setOpenFailed(true);
            });
          }}
        >
          {t({ id: "sidecarReview.open.action", message: "Open" })}
        </Button>
      )}
      {isEnded && (
        <Button
          variant="secondary"
          size="sm"
          disabled={!canReachApp}
          data-testid="sidecar-review-ask-again"
          onClick={() => {
            askForReviewAgain(linkKey);
            requestClientOperationSweep();
          }}
        >
          {t({ id: "sidecarReview.ended.action", message: "Ask again" })}
        </Button>
      )}
      {openFailed && (
        <p className="text-xs text-theme-fg-muted" role="alert">
          {t({
            id: "sidecarReview.open.failed",
            message:
              "The Erato desktop app could not show this review. Check that it is running, then try again.",
          })}
        </p>
      )}
    </div>
  );
};
