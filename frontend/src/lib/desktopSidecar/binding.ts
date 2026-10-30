/* eslint-disable lingui/no-unlocalized-strings -- Protocol identifiers. */
import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SidecarSnapshot } from "@erato/desktop-sidecar-protocol";

export const DESKTOP_SIDECAR_HOST_CONTEXT = "desktop_sidecar";

/**
 * The binding a delegated task's sidecar calls wait for, in normal mode only.
 * The sidecar reports no installation id (discovery has only a per-process
 * instance id, which a restart would change under every parked call), so the
 * device is this Erato client's routing id and the identity a constant.
 * Strict mode never gets one: any delegation declaration keeps the sidecar's
 * reads on the device.
 */
export function desktopSidecarBinding(
  snapshot: SidecarSnapshot,
  deviceId: string | undefined,
): ExecutorBinding | undefined {
  if (!deviceId || snapshot.state !== "ready" || snapshot.localDelegation)
    return undefined;
  return {
    device_id: deviceId,
    realm: "desktop-sidecar",
    host_context: { kind: DESKTOP_SIDECAR_HOST_CONTEXT, identity: "local" },
  };
}
