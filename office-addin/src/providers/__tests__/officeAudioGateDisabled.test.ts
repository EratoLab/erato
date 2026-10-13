import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOfficeAudioAccess,
  isOfficeAudioCaptureSupported,
} from "../officeAudioAccess";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Office audio with the permission gate disabled", () => {
  it.each(["Outlook", "Word", null])(
    "allows browser microphone access in %s without Office permission APIs",
    async (host) => {
      vi.stubGlobal("Office", undefined);
      const beforeReload = vi.fn();
      const reload = vi.fn();
      expect(isOfficeAudioCaptureSupported()).toBe(true);

      const policy = createOfficeAudioAccess({
        host,
        supported: false,
        beforeReload,
        reload,
      });
      expect(policy.canEnumerateDevices()).toBe(true);
      await expect(policy.beforeCapture()).resolves.toBeUndefined();
      expect(beforeReload).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it("does not check capabilities or request Office consent even when available", async () => {
    const isSetSupported = vi.fn(() => false);
    const requestPermissions = vi.fn();
    const requestPermissionsAsync = vi.fn();
    vi.stubGlobal("Office", {
      context: { requirements: { isSetSupported } },
      devicePermission: { requestPermissions, requestPermissionsAsync },
    });

    expect(isOfficeAudioCaptureSupported()).toBe(true);
    const policy = createOfficeAudioAccess({
      host: "Outlook",
      supported: true,
      beforeReload: vi.fn(),
    });
    await policy.beforeCapture();
    expect(isSetSupported).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
