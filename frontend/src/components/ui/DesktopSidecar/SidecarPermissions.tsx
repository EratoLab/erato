import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import { Button } from "../Controls/Button";

import type { SidecarStatusV1Result } from "@erato/desktop-sidecar-protocol";

export function SidecarPermissions() {
  const { client, snapshot } = useDesktopSidecar();
  if (snapshot.state !== "ready" || !client?.supports("sidecar.status.v1"))
    return null;
  return (
    <PermissionList key={snapshot.instanceId ?? "sidecar"} client={client} />
  );
}

function PermissionList({
  client,
}: {
  client: NonNullable<ReturnType<typeof useDesktopSidecar>["client"]>;
}) {
  const [permissions, setPermissions] = useState<
    SidecarStatusV1Result["permissions"] | null
  >(null);
  const [loadError, setLoadError] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await client.invoke(
          "sidecar.status.v1",
          {},
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setPermissions(result.permissions);
          setLoadError(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setPermissions(null);
          setLoadError(true);
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, refresh]);
  const applicable = Object.entries(permissions ?? {}).filter(
    ([, state]) => state !== "not_appliccable_different_platform",
  );
  const labels = {
    granted: t({ id: "sidecar.permissions.granted", message: "Granted" }),
    not_granted: t({
      id: "sidecar.permissions.notGranted",
      message: "Not granted",
    }),
    unknown: t({ id: "sidecar.permissions.unknown", message: "Unknown" }),
  };
  if (permissions && applicable.length === 0) return null;
  return (
    <section
      className="space-y-3 border-t border-theme-border pt-4"
      aria-label={t({
        id: "sidecar.permissions.title",
        message: "System permissions",
      })}
    >
      <h4 className="text-sm font-medium">
        {t({ id: "sidecar.permissions.title", message: "System permissions" })}
      </h4>
      {loadError ? (
        <p role="alert">
          {t({
            id: "sidecar.permissions.loadError",
            message: "Could not check system permissions.",
          })}
        </p>
      ) : permissions === null ? (
        <p>
          {t({
            id: "sidecar.permissions.loading",
            message: "Checking system permissions…",
          })}
        </p>
      ) : null}
      {applicable.map(([permission, state]) => (
        <div key={permission} className="space-y-2">
          <p className="text-sm">
            {permission === "macos_full_disk_access"
              ? t({
                  id: "sidecar.permissions.fullDiskAccess",
                  message: "Full Disk Access",
                })
              : permission}
            :{" "}
            {state === "granted"
              ? labels.granted
              : state === "not_granted"
                ? labels.not_granted
                : labels.unknown}
          </p>
          {permission === "macos_full_disk_access" && state !== "granted" && (
            <p className="text-xs text-theme-fg-secondary">
              {t({
                id: "sidecar.permissions.fullDiskAccessHelp",
                message:
                  "To access Outlook and Teams data without repeated prompts, open System Settings > Privacy & Security > Full Disk Access. Add and enable the running Erato Desktop Sidecar app, then restart the sidecar. Full Disk Access allows the app to read files and data from other apps.",
              })}
            </p>
          )}
          {state !== "granted" &&
            client.supports("sidecar.request_permission.v1") && (
              <Button
                variant="secondary"
                size="sm"
                loading={requesting === permission}
                disabled={requesting !== null}
                onClick={() => {
                  setRequesting(permission);
                  setRequestError(false);
                  void client
                    .invoke("sidecar.request_permission.v1", { permission })
                    .then((result) => {
                      if (!result.opened) setRequestError(true);
                    })
                    .catch(() => setRequestError(true))
                    .finally(() => {
                      setRequesting(null);
                      setRefresh((value) => value + 1);
                    });
                }}
              >
                {permission === "macos_full_disk_access"
                  ? t({
                      id: "sidecar.permissions.openSettings",
                      message: "Open System Settings",
                    })
                  : t({
                      id: "sidecar.permissions.request",
                      message: "Request permission",
                    })}
              </Button>
            )}
        </div>
      ))}
      {requestError && (
        <p role="alert">
          {t({
            id: "sidecar.permissions.requestError",
            message:
              "Could not open the permission settings. Open your system settings manually and try again.",
          })}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setRefresh((value) => value + 1)}
      >
        {t({
          id: "sidecar.permissions.refresh",
          message: "Check permissions again",
        })}
      </Button>
    </section>
  );
}
