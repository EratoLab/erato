import { t } from "@lingui/core/macro";
import { useState } from "react";

import {
  DEFAULT_DESKTOP_SIDECAR_ENDPOINT,
  DesktopSidecarProvider,
  resolveDesktopSidecarEndpoint,
  useDesktopSidecar,
} from "@/providers/DesktopSidecarProvider";

import { Button } from "../Controls/Button";
import { CheckCircleIcon, ComputerIcon, WarningCircleIcon } from "../icons";

// eslint-disable-next-line lingui/no-unlocalized-strings -- Desktop-sidecar URL protocol.
const DESKTOP_SIDECAR_LAUNCH_URL = "erato-launch://launch";

export function DesktopSidecarTabContent() {
  const [attempt, setAttempt] = useState(0);

  return (
    <DesktopSidecarProvider
      key={attempt}
      endpoint={
        resolveDesktopSidecarEndpoint() ?? DEFAULT_DESKTOP_SIDECAR_ENDPOINT
      }
      retryDiscovery={false}
    >
      <DesktopSidecarStatus
        onRetry={() => setAttempt((currentAttempt) => currentAttempt + 1)}
      />
    </DesktopSidecarProvider>
  );
}

function DesktopSidecarStatus({ onRetry }: { onRetry: () => void }) {
  const { snapshot } = useDesktopSidecar();
  const connected = snapshot.state === "ready";
  const connecting = snapshot.state === "discovering";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-theme-fg-primary">
          {t({
            id: "preferences.dialog.desktopSidecar.heading",
            message: "Desktop Sidecar",
          })}
        </h2>
        <p className="text-sm text-theme-fg-secondary">
          {t({
            id: "preferences.dialog.desktopSidecar.description",
            message:
              "Check the connection to the Erato Desktop Sidecar on this computer.",
          })}
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-[var(--theme-radius-control)] border border-theme-border bg-theme-bg-secondary p-4">
        {connected ? (
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-theme-success-fg" />
        ) : (
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-theme-warning-fg" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-theme-fg-primary">
            {connected
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
                  })}
          </p>
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
                  message:
                    "Start the desktop sidecar, then try connecting again.",
                })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
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
