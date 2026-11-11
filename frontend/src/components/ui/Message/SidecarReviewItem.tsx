import { t } from "@lingui/core/macro";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { requestClientOperationSweep } from "@/lib/clientOperations/handlers";
import { reopenSidecarReview } from "@/lib/desktopSidecar/sidecarJobs";
import {
  askForReviewAgain,
  isTaskReview,
} from "@/lib/desktopSidecar/sidecarReviewLinks";
import { sidecarToolLabel } from "@/lib/desktopSidecar/toolLabels";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { Button } from "../Controls/Button";

import type { SidecarReviewLink } from "@/lib/desktopSidecar/sidecarReviewLinks";

/**
 * A call of this turn that waits for its review in the Erato desktop app, in
 * the approval slot. The decision is made only in the app's window; this
 * shows that window again, or, once the review has ended, asks again.
 *
 * Like `WaitingTaskItem` and `ParkedChildItem`, it sits inside the card that
 * owns the approval shell. Like `ActionConfirmationCard` inside that shell,
 * the item is a labelled group that announces its title politely and takes
 * keyboard focus when the button that had it goes away. While the app cannot
 * be reached, its action stays focusable but inert, and a visible line says
 * why.
 *
 * A task's review shows inside the task's item on the response it runs for,
 * so that response's slot holds it too. A task's call ends with its review,
 * so an ended one has nothing to ask again, wherever it shows: the link says
 * whether the call is a task's, so the task's own chat reads the same.
 */
export const SidecarReviewItem = ({
  linkKey,
  link,
  toolName,
  inTaskItem = false,
}: {
  linkKey: string;
  link: SidecarReviewLink;
  /** The waiting call's tool, to say what is waiting. */
  toolName: string | undefined;
  /**
   * The item sits inside a task's item on the response the task runs for,
   * so its call is that task's whatever its link records.
   */
  inTaskItem?: boolean;
}) => {
  const { client } = useDesktopSidecar();
  const [openFailed, setOpenFailed] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const unreachableReasonId = useId();
  const canReachApp = client?.supports("jobs.review.v1") === true;
  const forTask = inTaskItem || isTaskReview(link);
  const isEnded = link.state === "ended";
  const canAskAgain = isEnded && !forTask;
  const hasAction = link.state === "open" || canAskAgain;
  const title = isEnded
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
        });

  // Live regions announce changes, so the region starts empty and takes the
  // title after paint: the item's appearance and each change of state are
  // then read out.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    setAnnouncement(title);
  }, [title]);

  // A change of state can remove the button that had focus: Ask again does,
  // and so does an Open that finds the review ended. Focus left on the page
  // then moves to the item, never away from another element.
  const focusCard = () => cardRef.current?.focus({ preventScroll: true });
  const shownState = useRef(link.state);
  useLayoutEffect(() => {
    if (shownState.current === link.state) return;
    shownState.current = link.state;
    const active = document.activeElement;
    if (active === null || active === document.body) focusCard();
  }, [link.state]);

  // aria-disabled instead of disabled keeps the action in the tab order, so
  // the reason it cannot be used is found with it.
  const unreachable = canReachApp
    ? {}
    : {
        "aria-disabled": true,
        "aria-describedby": unreachableReasonId,
        className: "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
      };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-label={title}
      data-testid="sidecar-review-item"
      data-review-state={link.state}
      // Rounded and offset, as the ring was when the item drew the card; it
      // now sits inside the card that owns the shell, or inside a task's item.
      className={`${inTaskItem ? "mt-1 rounded-md" : "rounded-[var(--theme-radius-message)]"} focus-ring space-y-2`}
    >
      <div>
        <p className="text-sm font-medium text-theme-fg-primary">{title}</p>
        {toolName && (
          <p className="text-sm text-theme-fg-secondary">
            {sidecarToolLabel(toolName)}
          </p>
        )}
        <p className="text-xs text-theme-fg-muted">
          {isEnded
            ? forTask
              ? t({
                  id: "sidecarReview.ended.taskDescription",
                  message:
                    "Nothing was shared. The task goes on without this result. A review ends one hour after it starts.",
                })
              : t({
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
          {...unreachable}
          data-testid="sidecar-review-open"
          onClick={() => {
            if (!client || !canReachApp) return;
            setOpenFailed(false);
            reopenSidecarReview(client, linkKey).catch(() => {
              setOpenFailed(true);
            });
          }}
        >
          {t({ id: "sidecarReview.open.action", message: "Open" })}
        </Button>
      )}
      {canAskAgain && (
        <Button
          variant="secondary"
          size="sm"
          {...unreachable}
          data-testid="sidecar-review-ask-again"
          onClick={() => {
            if (!canReachApp) return;
            // The button goes away with the state it belongs to.
            focusCard();
            askForReviewAgain(linkKey);
            requestClientOperationSweep();
          }}
        >
          {t({ id: "sidecarReview.ended.action", message: "Ask again" })}
        </Button>
      )}
      {hasAction && !canReachApp && (
        <p id={unreachableReasonId} className="text-xs text-theme-fg-muted">
          {t({
            id: "sidecarReview.unreachable",
            message: "Start the Erato desktop app to continue this review.",
          })}
        </p>
      )}
      {openFailed && (
        <p className="text-sm text-theme-error-fg" role="alert">
          {t({
            id: "sidecarReview.open.failed",
            message:
              "The Erato desktop app could not show this review. Check that it is running, then try again.",
          })}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
};
