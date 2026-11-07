import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

import { useSidecarStatus } from "@/hooks/useSidecarStatus";
import { useDesktopSidecar } from "@/providers/DesktopSidecarProvider";

import type { SidecarUiPackageStatus as UiPackageStatus } from "@erato/desktop-sidecar-protocol";

/** Whether the sidecar installed the deployment's desktop UI package. */
export function SidecarUiPackageStatus() {
  const { client, snapshot } = useDesktopSidecar();
  if (
    snapshot.state !== "ready" ||
    !snapshot.ui ||
    !client?.supports("sidecar.status.v1")
  )
    return null;
  return <UiPackageLine key={snapshot.instanceId ?? "sidecar"} />;
}

function UiPackageLine() {
  const status = useSidecarStatus().data?.ui_package;
  if (!status) return null;
  return <p className="text-sm">{statusLabel(status)}</p>;
}

function statusLabel(status: UiPackageStatus): string {
  if (status.state === "current")
    return t({
      id: "sidecar.uiPackage.current",
      message: "Desktop app interface: up to date",
    });
  if (status.state !== "failed")
    return t({
      id: "sidecar.uiPackage.pending",
      message: "Desktop app interface: updating…",
    });
  return i18n._({
    id: "sidecar.uiPackage.failed",
    message: "Desktop app interface: update failed ({reason})",
    values: { reason: reasonLabel(status.reason) },
  });
}

function reasonLabel(reason: string | undefined): string {
  switch (reason) {
    case "network":
      return t({
        id: "sidecar.uiPackage.reason.network",
        message: "network error",
      });
    case "proxy":
      return t({
        id: "sidecar.uiPackage.reason.proxy",
        message: "the proxy refused the connection",
      });
    case "tls":
      return t({
        id: "sidecar.uiPackage.reason.tls",
        message: "certificate not trusted",
      });
    case "unauthorized":
      return t({
        id: "sidecar.uiPackage.reason.unauthorized",
        message: "access was refused",
      });
    case "not_found":
      return t({
        id: "sidecar.uiPackage.reason.notFound",
        message: "no package on the server",
      });
    case "verification":
      return t({
        id: "sidecar.uiPackage.reason.verification",
        message: "the package did not verify",
      });
    case "storage":
      return t({
        id: "sidecar.uiPackage.reason.storage",
        message: "could not be saved on this device",
      });
    default:
      return t({
        id: "sidecar.uiPackage.reason.other",
        message: "unexpected error",
      });
  }
}
