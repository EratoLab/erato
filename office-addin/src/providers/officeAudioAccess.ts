import type { AudioCaptureAccessPolicy } from "@erato/frontend/library";

export function isOfficeAudioCaptureSupported(): boolean {
  let supported = false;
  try {
    supported = Office.context.requirements.isSetSupported(
      "DevicePermissionService",
      "1.1",
    );
  } catch {
    // Older Office hosts may not expose requirements at all.
  }
  if (!supported) {
    console.debug(
      "Microphone features are unavailable because DevicePermissionService 1.1 is not supported.",
    );
  }
  return supported;
}

export function createOfficeAudioAccess({
  host,
  supported,
  beforeReload,
  reload = () => window.location.reload(),
}: {
  host: string | null;
  supported: boolean;
  beforeReload: () => void;
  reload?: () => void;
}): AudioCaptureAccessPolicy {
  let permissionEffective = false;
  let reloadRequired = false;
  let pending: Promise<void> | null = null;

  const request = async () => {
    if (!supported) {
      throw new DOMException(
        "DevicePermissionService 1.1 is unavailable",
        "NotAllowedError",
      );
    }
    if (!reloadRequired) {
      let newlyGranted: boolean;
      try {
        const permissions = [Office.DevicePermissionType.microphone];
        if (host === "Outlook") {
          newlyGranted = await new Promise<boolean>((resolve, reject) => {
            Office.devicePermission.requestPermissionsAsync(
              permissions,
              (result) => {
                if (
                  result.status === Office.AsyncResultStatus.Succeeded &&
                  typeof result.value === "boolean"
                ) {
                  resolve(result.value);
                } else {
                  reject(new Error("Office microphone permission was denied"));
                }
              },
            );
          });
        } else if (host === "Word") {
          newlyGranted =
            await Office.devicePermission.requestPermissions(permissions);
          if (typeof newlyGranted !== "boolean")
            throw new Error("Invalid permission response");
        } else {
          throw new Error("Unsupported Office host");
        }
      } catch {
        // Existing recorder/settings error handlers translate this into permission feedback
        // and unwind their loading state. Never fall back to direct browser capture.
        throw new DOMException(
          "Office microphone permission was denied or failed",
          "NotAllowedError",
        );
      }
      reloadRequired = newlyGranted;
    }
    if (reloadRequired) {
      beforeReload();
      reload();
      // Navigation is asynchronous. No caller may open a stream in this document.
      throw new DOMException(
        "Reloading after Office microphone consent",
        "AbortError",
      );
    }
    permissionEffective = true;
  };

  return {
    canEnumerateDevices: () => permissionEffective && !reloadRequired,
    beforeCapture: () => {
      if (!pending) {
        pending = request().finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}
