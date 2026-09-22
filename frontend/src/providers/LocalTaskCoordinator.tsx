import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Controls/Button";
import { useProfileApi } from "@/hooks/profile/useProfileApi";
import {
  LocalTaskCoordinator as Coordinator,
  localTaskApi,
} from "@/lib/desktopSidecar/localTaskCoordinator";

import { useDesktopSidecar } from "./DesktopSidecarProvider";

import type {
  LocalTaskView,
  LocalTaskViewState,
} from "@/lib/desktopSidecar/localTaskCoordinator";

function label(state: LocalTaskViewState): string {
  switch (state) {
    case "queued":
    case "running":
      return t`Collecting evidence on this device`;
    case "ready_for_review":
      return t`Ready for review in the desktop app`;
    case "approved":
      return t`Approved evidence is ready to upload`;
    case "awaiting_authenticated_resume":
    case "continuing":
    case "acknowledged":
      return t`Continuing the original task`;
    case "declined":
      return t`Sharing declined on this device`;
    case "cancelled":
      return t`Local task cancelled`;
    case "expired":
      return t`Local task expired`;
    case "failed":
      return t`Local collection could not finish`;
    case "another_device":
      return t`Waiting for the device that accepted this task`;
    case "unavailable":
      return t`Waiting for the desktop app to reconnect`;
  }
}
/** Shared authenticated shell UI. Views contain cloud IDs and fixed local state
 * only; the native app owns previews, selection and the approval decision. */
export function LocalTaskCoordinator() {
  const { client, snapshot } = useDesktopSidecar();
  const { profile, error, refreshProfile } = useProfileApi();
  const [views, setViews] = useState<LocalTaskView[]>([]);
  const coordinator = useRef<Coordinator | null>(null);
  const accountId = !error ? profile?.id : undefined;
  useEffect(() => {
    setViews([]);
    if (!accountId) return;
    const instance = new Coordinator(
      accountId,
      client,
      localTaskApi,
      setViews,
      () => {
        void refreshProfile();
      },
    );
    coordinator.current = instance;
    const reconcile = () => {
      if (!document.hidden) void instance.reconcile();
    };
    reconcile();
    const timer = window.setInterval(reconcile, 10_000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      instance.dispose();
      coordinator.current = null;
    };
  }, [accountId, client, snapshot.instanceId, refreshProfile]);
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
          <a
            href={`/chat/${encodeURIComponent(view.chatId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline"
          >{t`Open original task`}</a>
          <p className="my-2 text-sm" role="status">
            {label(view.state)}
          </p>
          <div className="flex gap-2">
            {view.state === "ready_for_review" && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  void coordinator.current?.review(view.id);
                }}
              >{t`Review in desktop app`}</Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void coordinator.current?.cancel(view.id);
              }}
            >{t`Cancel task`}</Button>
          </div>
        </div>
      ))}
    </aside>
  );
}
