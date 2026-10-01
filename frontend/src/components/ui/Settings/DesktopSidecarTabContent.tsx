import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import {
  DEFAULT_DESKTOP_SIDECAR_ENDPOINT,
  DesktopSidecarProvider,
  DesktopSidecarConfigurationSync,
  resolveDesktopSidecarEndpoint,
  useDesktopSidecar,
} from "@/providers/DesktopSidecarProvider";

import { ClientToolFileApprovalSetting } from "./ClientToolFileApprovalSetting";
import { EntityRow } from "./EntityRow";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SidecarToolDecisions } from "./SidecarToolDecisions";
import { Button } from "../Controls/Button";
import { SidecarIndexingControls } from "../DesktopSidecar/SidecarIndexingCard";
import { ComputerIcon, FolderIcon } from "../icons";

// eslint-disable-next-line lingui/no-unlocalized-strings -- Desktop-sidecar URL protocol.
const DESKTOP_SIDECAR_LAUNCH_URL = "erato-launch://launch";

/**
 * The sidecar as one entity row of the Servers & Tools pane: connection
 * state on the header, retry/launch actions in the details. Wraps its own
 * provider — a remount per attempt is the retry.
 */
export function DesktopSidecarRow() {
  const [attempt, setAttempt] = useState(0);

  return (
    <DesktopSidecarProvider
      key={attempt}
      endpoint={
        resolveDesktopSidecarEndpoint() ?? DEFAULT_DESKTOP_SIDECAR_ENDPOINT
      }
      retryDiscovery={false}
    >
      <DesktopSidecarConfigurationSync />
      <DesktopSidecarEntityRow
        defaultExpanded={attempt > 0}
        onRetry={() => setAttempt((currentAttempt) => currentAttempt + 1)}
      />
    </DesktopSidecarProvider>
  );
}

function DesktopSidecarEntityRow({
  onRetry,
  defaultExpanded,
}: {
  onRetry: () => void;
  defaultExpanded: boolean;
}) {
  const { client, snapshot } = useDesktopSidecar();
  const permissionsId = useId();
  const connected = snapshot.state === "ready";
  const connecting = snapshot.state === "discovering";

  const statusLabel = connected
    ? t({
        id: "preferences.dialog.desktopSidecar.status.connected",
        message: "Connected",
      })
    : connecting
      ? t({
          id: "preferences.dialog.desktopSidecar.status.connecting",
          message: "Connecting...",
        })
      : t({
          id: "preferences.dialog.desktopSidecar.status.unavailable",
          message: "Not connected",
        });

  return (
    <EntityRow
      // Retrying remounts the provider and this row. The retry action lives in
      // the expanded details, so restore that state on the new attempt.
      defaultExpanded={defaultExpanded}
      icon={<ComputerIcon className="size-4 text-theme-fg-secondary" />}
      name={t({
        id: "preferences.dialog.desktopSidecar.heading",
        message: "Desktop Sidecar",
      })}
      status={{ tone: connected ? "success" : "warning", label: statusLabel }}
      caption={i18n._({
        id: "preferences.dialog.serversTools.scope.thisDevice",
        message: "{status} · this device",
        values: { status: statusLabel },
      })}
      data-testid="servers-tools-sidecar-row"
    >
      <div className="space-y-6">
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.desktopSidecar.introduction",
            message:
              "Connect the assistant to emails, files and Teams messages available on this device.",
          })}
        </p>
        {!connected && (
          <p className="text-sm text-theme-fg-secondary">
            {t({
              id: "preferences.dialog.desktopSidecar.unavailable.description",
              message: "Start the desktop sidecar, then try connecting again.",
            })}
          </p>
        )}
        <section aria-labelledby={permissionsId} className="space-y-4">
          <div className="space-y-1">
            <h3
              id={permissionsId}
              className="text-sm font-medium text-theme-fg-primary"
            >
              {t({
                id: "preferences.dialog.desktopSidecar.permissions.title",
                message: "Tool permissions",
              })}
            </h3>
            {!snapshot.localDelegation && (
              <p className="text-xs text-theme-fg-secondary">
                {t({
                  id: "preferences.dialog.desktopSidecar.permissions.description",
                  message:
                    "Choose when the assistant may use content from this device. Permission changes are saved automatically.",
                })}
              </p>
            )}
          </div>
          {snapshot.localDelegation ? (
            <p className="text-sm text-theme-fg-secondary">{t`Evidence sharing requires review in the desktop app for each package.`}</p>
          ) : (
            <ClientToolFileApprovalSetting />
          )}
          {connected && !snapshot.localDelegation && client && (
            <SidecarToolDecisions client={client} />
          )}
        </section>
        {connected &&
        !snapshot.localDelegation &&
        client?.supports("indexing.status.v1") ? (
          <SidecarIndexingControls
            connectionActions={<SidecarConnectionActions onRetry={onRetry} />}
          />
        ) : (
          <div className="border-t border-theme-border pt-4">
            <SettingsDisclosure
              headingLevel={3}
              title={t({
                id: "preferences.dialog.desktopSidecar.connection",
                message: "Connection",
              })}
              defaultExpanded={!connected}
            >
              <SidecarConnectionActions onRetry={onRetry} />
            </SettingsDisclosure>
          </div>
        )}
      </div>
    </EntityRow>
  );
}

function SidecarConnectionActions({ onRetry }: { onRetry: () => void }) {
  const { client, snapshot } = useDesktopSidecar();
  const connected = snapshot.state === "ready";
  const connecting = snapshot.state === "discovering";
  const [openingDataDirectory, setOpeningDataDirectory] = useState(false);
  const [openDataDirectoryError, setOpenDataDirectoryError] = useState(false);
  return (
    <div className="space-y-3">
      {openDataDirectoryError ? (
        <p role="alert" className="text-sm text-theme-error-fg">
          {t({
            id: "preferences.dialog.desktopSidecar.openDataDirectory.error",
            message: "Could not open the sidecar data directory.",
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {connected &&
        !snapshot.localDelegation &&
        client?.supports("sidecar.open_data_directory.v1") ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderIcon className="size-4" />}
            loading={openingDataDirectory}
            onClick={() => {
              setOpeningDataDirectory(true);
              setOpenDataDirectoryError(false);
              void client
                .invoke("sidecar.open_data_directory.v1", {})
                .catch(() => setOpenDataDirectoryError(true))
                .finally(() => setOpeningDataDirectory(false));
            }}
          >
            {t({
              id: "preferences.dialog.desktopSidecar.openDataDirectory",
              message: "Open data directory",
            })}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          icon={<ComputerIcon className="size-4" />}
          disabled={connecting}
          onClick={onRetry}
        >
          {connecting
            ? t({
                id: "preferences.dialog.desktopSidecar.retry.connecting",
                message: "Connecting...",
              })
            : t({
                id: "preferences.dialog.desktopSidecar.retry",
                message: "Retry connection",
              })}
        </Button>
        {!connected ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              window.location.assign(DESKTOP_SIDECAR_LAUNCH_URL);
            }}
          >
            {t({
              id: "preferences.dialog.desktopSidecar.launch",
              message: "Launch Desktop Sidecar",
            })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
