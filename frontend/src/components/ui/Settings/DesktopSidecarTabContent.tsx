import { t } from "@lingui/core/macro";
import { useState } from "react";

import { useSidecarNetworkPermission } from "@/hooks/useSidecarNetworkPermission";
import {
  DEFAULT_DESKTOP_SIDECAR_ENDPOINT,
  DesktopSidecarProvider,
  DesktopSidecarConfigurationSync,
  resolveDesktopSidecarEndpoint,
  useDesktopSidecar,
} from "@/providers/DesktopSidecarProvider";

import { ClientToolFileApprovalSetting } from "./ClientToolFileApprovalSetting";
import { EntityRow } from "./EntityRow";
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
  const endpoint =
    resolveDesktopSidecarEndpoint() ?? DEFAULT_DESKTOP_SIDECAR_ENDPOINT;

  return (
    <DesktopSidecarProvider
      key={attempt}
      endpoint={endpoint}
      retryDiscovery={false}
    >
      <DesktopSidecarConfigurationSync />
      <DesktopSidecarEntityRow
        endpoint={endpoint}
        defaultExpanded={attempt > 0}
        onRetry={() => setAttempt((currentAttempt) => currentAttempt + 1)}
      />
    </DesktopSidecarProvider>
  );
}

function DesktopSidecarEntityRow({
  endpoint,
  onRetry,
  defaultExpanded,
}: {
  endpoint: string;
  onRetry: () => void;
  defaultExpanded: boolean;
}) {
  const { client, snapshot } = useDesktopSidecar();
  const permission = useSidecarNetworkPermission(endpoint);
  const permissionDenied = permission === "denied";
  const [openingDataDirectory, setOpeningDataDirectory] = useState(false);
  const [openDataDirectoryError, setOpenDataDirectoryError] = useState(false);
  const connected = snapshot.state === "ready";
  const connecting = snapshot.state === "discovering";

  const status = permissionDenied
    ? t({
        id: "preferences.dialog.desktopSidecar.permission.denied",
        message: "Local application access blocked",
      })
    : connected
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
      status={{
        tone: connected && !permissionDenied ? "success" : "warning",
        label: status,
      }}
      caption={t({
        id: "preferences.dialog.serversTools.scope.thisDevice",
        message: `${status} · this device`,
      })}
      data-testid="servers-tools-sidecar-row"
    >
      {permissionDenied && (
        <p role="alert" className="text-sm text-theme-warning-fg">
          {t({
            id: "preferences.dialog.desktopSidecar.permission.description",
            message:
              "The browser has blocked access to local applications. This permission is required to connect to the desktop sidecar. Open this site's permissions using the icon next to the address bar and allow or reset local application or local network access, then retry. The browser cannot show the prompt again while access is blocked.",
          })}
        </p>
      )}
      <p className="text-sm text-theme-fg-secondary">
        {connected && snapshot.serverInfo
          ? t({
              id: "preferences.dialog.desktopSidecar.connected.description",
              message: "{name} {version} is ready to use.",
              values: {
                name: snapshot.serverInfo.name,
                version: snapshot.serverInfo.version,
              },
            })
          : t({
              id: "preferences.dialog.desktopSidecar.unavailable.description",
              message: "Start the desktop sidecar, then try connecting again.",
            })}
      </p>
      <ClientToolFileApprovalSetting />
      {connected && client?.supports("indexing.status.v1") && (
        <SidecarIndexingControls />
      )}
      {openDataDirectoryError ? (
        <p role="alert" className="text-sm text-theme-error-fg">
          {t({
            id: "preferences.dialog.desktopSidecar.openDataDirectory.error",
            message: "Could not open the sidecar data directory.",
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {connected && client?.supports("sidecar.open_data_directory.v1") ? (
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
            : permissionDenied || permission === "prompt"
              ? t({
                  id: "preferences.dialog.desktopSidecar.permission.retry",
                  message: "Retry local application access",
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
    </EntityRow>
  );
}
