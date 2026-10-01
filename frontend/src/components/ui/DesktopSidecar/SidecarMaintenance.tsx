import { t } from "@lingui/core/macro";

import { Button } from "../Controls/Button";
import { SettingsDisclosure } from "../Settings/SettingsDisclosure";
import { Trash } from "../icons";

import type { useSidecarIndexing } from "@/hooks/useSidecarIndexing";
import type { ReactNode } from "react";

export function SidecarMaintenance({
  indexing,
  children,
}: {
  indexing: ReturnType<typeof useSidecarIndexing>;
  children?: ReactNode;
}) {
  const {
    data,
    saving,
    reset,
    resetSupported,
    resetting,
    resetError,
    resetSucceeded,
  } = indexing;
  const busy = saving || resetting || data?.status.resetInProgress === true;
  if (!children && !resetSupported) return null;
  return (
    <div className="border-t border-theme-border pt-4">
      <SettingsDisclosure
        headingLevel={3}
        title={t({ id: "sidecar.maintenance.title", message: "Maintenance" })}
        description={t({
          id: "sidecar.maintenance.description",
          message: "Manage the connection and local search data.",
        })}
      >
        {children}
        {resetSupported && data && (
          <div className="space-y-3 border-t border-theme-border pt-4">
            <p className="text-xs text-theme-fg-secondary">
              {t({
                id: "sidecar.indexing.resetHelp",
                message:
                  "Resetting clears the local search index and stops indexing. Your original content and settings are kept.",
              })}
            </p>
            <Button
              variant="danger"
              icon={<Trash className="size-4" />}
              disabled={busy}
              loading={resetting}
              confirmAction
              confirmTitle={t({
                id: "sidecar.indexing.reset",
                message: "Reset sidecar indices",
              })}
              confirmMessage={t({
                id: "sidecar.indexing.resetConfirm",
                message:
                  "Clear all local search indices? Original emails, attachments and settings are kept. Indexing stays stopped until resumed or the sidecar is restarted.",
              })}
              onClick={() => reset()}
            >
              {t({
                id: "sidecar.indexing.reset",
                message: "Reset sidecar indices",
              })}
            </Button>
          </div>
        )}
        {resetError && (
          <p role="alert" className="text-theme-error-fg">
            {t({
              id: "sidecar.indexing.resetError",
              message:
                "Could not confirm the reset completed. Check the status or try again.",
            })}
          </p>
        )}
        {resetSucceeded && (
          <p role="status">
            {t({
              id: "sidecar.indexing.resetSuccess",
              message: "Local search indices cleared. Indexing is stopped.",
            })}
          </p>
        )}
      </SettingsDisclosure>
    </div>
  );
}
