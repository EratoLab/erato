import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { useProfileApi } from "@/hooks/profile/useProfileApi";
import {
  LocalTaskCoordinator as Coordinator,
  localTaskApi,
} from "@/lib/desktopSidecar/localTaskCoordinator";
import { localTaskLabel } from "@/lib/desktopSidecar/localTaskLabels";
import { publishLocalTaskViews } from "@/lib/desktopSidecar/localTaskViewsStore";
import { getChatUrl } from "@/utils/chat/urlUtils";

import { useDelegatedRunOpener } from "./DelegatedRunOpenProvider";
import { useDesktopSidecar } from "./DesktopSidecarProvider";

import type { LocalTaskView } from "@/lib/desktopSidecar/localTaskCoordinator";

/** Steady-state inbox cadence; the idle load of an authenticated shell. */
const SWEEP_INTERVAL_MS = 10_000;
/** Cadence while a native job is expected to change state soon. */
const ACTIVE_SWEEP_INTERVAL_MS = 1_500;
/** How long an opened review window keeps the active cadence. The native app
 * never reports a closed window, so an abandoned review falls back to idle. */
const REVIEW_ATTENTION_MS = 5 * 60_000;

/**
 * Exported for unit testing. The sidecar has no push channel: a job's
 * `ready_for_review` and `approved` transitions are observed only by a sweep,
 * so the poll runs fast while collection is under way or a review window has
 * just been opened, and idles otherwise.
 */
export function sweepIntervalFor(
  views: readonly LocalTaskView[],
  reviewOpenedAt: ReadonlyMap<string, number>,
  now: number,
): number {
  const active = views.some((view) => {
    if (view.state === "queued" || view.state === "running") return true;
    const openedAt = reviewOpenedAt.get(view.id);
    return (
      view.state === "ready_for_review" &&
      openedAt !== undefined &&
      now - openedAt < REVIEW_ATTENTION_MS
    );
  });
  return active ? ACTIVE_SWEEP_INTERVAL_MS : SWEEP_INTERVAL_MS;
}

/** Shared authenticated shell UI. Views contain cloud IDs and fixed local state
 * only; the native app owns previews, selection and the approval decision. */
export function LocalTaskCoordinator() {
  const { client, snapshot } = useDesktopSidecar();
  const openRun = useDelegatedRunOpener();
  const { profile, error, refreshProfile } = useProfileApi();
  const [views, setViews] = useState<LocalTaskView[]>([]);
  // Review windows this shell opened, by job id, as `Date.now()` at the click.
  const [reviewOpenedAt, setReviewOpenedAt] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [coordinator, setCoordinator] = useState<Coordinator | null>(null);
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  // Retain cached identity during transient profile failures. Auth failures and
  // the coordinator's authoritative account comparison still dispose old work.
  const accountId = status === 401 || status === 403 ? undefined : profile?.id;
  useEffect(() => {
    setViews([]);
    setReviewOpenedAt(new Map());
    if (!accountId) {
      setCoordinator(null);
      return;
    }
    const instance = new Coordinator(
      accountId,
      client,
      localTaskApi,
      setViews,
      () => {
        void refreshProfile();
      },
    );
    setCoordinator(instance);
    return () => {
      instance.dispose();
    };
  }, [accountId, client, refreshProfile]);
  useQuery({
    queryKey: ["local-delegation-coordinator", accountId],
    enabled: !!coordinator && coordinator.accountId === accountId,
    queryFn: async () => {
      await coordinator?.reconcile();
      // Cache only cloud enablement. Native statuses, handles and approved bytes
      // stay out of the query cache and any automatic query-error reporting.
      return { enabled: coordinator?.enabled ?? false };
    },
    refetchInterval: (query) =>
      query.state.data?.enabled === false
        ? false
        : sweepIntervalFor(views, reviewOpenedAt, Date.now()),
    refetchOnWindowFocus: (query) =>
      query.state.data?.enabled === false ? false : "always",
    refetchOnReconnect: (query) =>
      query.state.data?.enabled === false ? false : "always",
    retry: false,
    gcTime: 0,
  });
  // The parent's task card shows what this device knows of its local tasks.
  useEffect(() => {
    publishLocalTaskViews(views);
  }, [views]);
  useEffect(() => () => publishLocalTaskViews([]), []);
  useEffect(() => {
    if (snapshot.state === "ready" && coordinator?.enabled)
      void coordinator.reconcile();
  }, [
    coordinator,
    snapshot.state,
    snapshot.instanceId,
    snapshot.strictLocalDelegation,
  ]);
  if (!views.length) return null;
  return (
    <aside
      aria-label={t`Local research tasks`}
      className="fixed bottom-4 right-4 z-40 max-h-[50vh] max-w-sm overflow-auto rounded-lg border border-theme-border bg-theme-bg-primary p-4 text-theme-fg-primary shadow-lg"
    >
      <h2 className="font-semibold">{t`Local research`}</h2>
      <p className="mb-3 text-sm text-theme-fg-secondary">{t`Review and choose evidence in the desktop app. Collection continues if this pane closes; uploading and cloud continuation wait until you return signed in.`}</p>
      {views.map((view) => (
        <div key={view.id} className="mb-3 border-t border-theme-border pt-3">
          {openRun ? (
            <button
              type="button"
              onClick={() => openRun(view.chatId)}
              className="text-sm underline"
            >
              {t`Open original task`}
            </button>
          ) : (
            <a
              href={getChatUrl(view.chatId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline"
            >
              {t`Open original task`}
            </a>
          )}
          <p className="my-2 text-sm" role="status">
            {localTaskLabel(view.state)}
          </p>
          <div className="flex gap-2">
            {view.state === "ready_for_review" && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setReviewOpenedAt((opened) =>
                    new Map(opened).set(view.id, Date.now()),
                  );
                  void coordinator?.review(view.id);
                }}
              >{t`Review in desktop app`}</Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void coordinator?.cancel(view.id);
              }}
            >{t`Cancel task`}</Button>
          </div>
        </div>
      ))}
    </aside>
  );
}
