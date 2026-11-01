/* eslint-disable lingui/no-unlocalized-strings -- Protocol identifiers. */
import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

export const DESKTOP_SIDECAR_HOST_CONTEXT = "desktop_sidecar";

/**
 * The binding a delegated task's sidecar calls wait for, in normal mode only.
 * Its device is the app's installation id, so every Erato window on the
 * computer serves the same binding and any of them continues a waiting call.
 * An app from before protocol 0.1.43 reports none; the binding then names
 * this client alone, as before. Strict mode never gets one: any delegation
 * declaration keeps the sidecar's reads on the device.
 */
export function desktopSidecarBinding(
  snapshot: SidecarSnapshot,
  clientId: string | undefined,
): ExecutorBinding | undefined {
  if (snapshot.state !== "ready" || snapshot.localDelegation) return undefined;
  const deviceId = snapshot.installationId ?? clientId;
  if (!deviceId) return undefined;
  return {
    device_id: deviceId,
    realm: "desktop-sidecar",
    host_context: { kind: DESKTOP_SIDECAR_HOST_CONTEXT, identity: "local" },
  };
}
