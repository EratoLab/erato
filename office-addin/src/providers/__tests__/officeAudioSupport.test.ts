import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOfficeAudioAccess,
  isOfficeAudioCaptureSupported,
} from "../officeAudioAccess";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockOffice(supported = true) {
  const office = {
    context: { requirements: { isSetSupported: vi.fn(() => supported) } },
    DevicePermissionType: { microphone: "microphone" },
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    devicePermission: {
      requestPermissions: vi.fn(async () => false),
      requestPermissionsAsync: vi.fn(
        (
          _permissions: unknown,
          callback: (result: { status: string; value?: boolean }) => void,
        ) => {
          callback({ status: "succeeded", value: false });
        },
      ),
    },
  };
  vi.stubGlobal("Office", office);
  return office;
}

describe("Office audio support", () => {
  it.each([true, false])(
    "requires DevicePermissionService 1.1: %s",
    (supported) => {
      const office = mockOffice(supported);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      expect(isOfficeAudioCaptureSupported()).toBe(supported);
      expect(office.context.requirements.isSetSupported).toHaveBeenCalledWith(
        "DevicePermissionService",
        "1.1",
      );
      if (!supported)
        expect(debug).toHaveBeenCalledWith(
          expect.stringContaining(
            "DevicePermissionService 1.1 is not supported",
          ),
        );
      else expect(debug).not.toHaveBeenCalled();
    },
  );

  it("fails closed on older hosts without the requirement API", () => {
    vi.stubGlobal("Office", { context: {} });
    expect(isOfficeAudioCaptureSupported()).toBe(false);
  });

  it("never requests permission on an unsupported host", async () => {
    const office = mockOffice(false);
    const policy = createOfficeAudioAccess({
      host: "Outlook",
      supported: false,
      beforeReload: vi.fn(),
    });
    await expect(policy.beforeCapture()).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(
      office.devicePermission.requestPermissionsAsync,
    ).not.toHaveBeenCalled();
    expect(policy.canEnumerateDevices()).toBe(false);
  });

  it.each(["Outlook", "Word"])(
    "continues an existing %s grant without reload",
    async (host) => {
      const office = mockOffice();
      const reload = vi.fn();
      const policy = createOfficeAudioAccess({
        host,
        supported: true,
        beforeReload: vi.fn(),
        reload,
      });
      expect(policy.canEnumerateDevices()).toBe(false);
      await policy.beforeCapture();
      expect(policy.canEnumerateDevices()).toBe(true);
      expect(reload).not.toHaveBeenCalled();
      if (host === "Outlook") {
        expect(
          office.devicePermission.requestPermissionsAsync,
        ).toHaveBeenCalledWith(["microphone"], expect.any(Function));
        expect(
          office.devicePermission.requestPermissions,
        ).not.toHaveBeenCalled();
      } else {
        expect(office.devicePermission.requestPermissions).toHaveBeenCalledWith(
          ["microphone"],
        );
        expect(
          office.devicePermission.requestPermissionsAsync,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["Outlook", "Word"])(
    "saves drafts before reloading for a new %s grant and never permits capture",
    async (host) => {
      const office = mockOffice();
      office.devicePermission.requestPermissions.mockResolvedValue(true);
      office.devicePermission.requestPermissionsAsync.mockImplementation(
        (_permissions, callback) =>
          callback({ status: "succeeded", value: true }),
      );
      const events: string[] = [];
      const policy = createOfficeAudioAccess({
        host,
        supported: true,
        beforeReload: () => {
          events.push("save");
        },
        reload: () => {
          events.push("reload");
        },
      });
      await expect(policy.beforeCapture()).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(events).toEqual(["save", "reload"]);
      expect(policy.canEnumerateDevices()).toBe(false);
    },
  );

  it.each(["Outlook", "Word"])(
    "denies capture after a failed %s request and allows retry",
    async (host) => {
      const office = mockOffice();
      office.devicePermission.requestPermissions.mockRejectedValueOnce(
        new Error("denied"),
      );
      office.devicePermission.requestPermissionsAsync.mockImplementationOnce(
        (_permissions, callback) => callback({ status: "failed" }),
      );
      const reload = vi.fn();
      const policy = createOfficeAudioAccess({
        host,
        supported: true,
        beforeReload: vi.fn(),
        reload,
      });
      await expect(policy.beforeCapture()).rejects.toMatchObject({
        name: "NotAllowedError",
      });
      expect(policy.canEnumerateDevices()).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      await policy.beforeCapture();
      expect(policy.canEnumerateDevices()).toBe(true);
    },
  );

  it("coalesces concurrent permission requests", async () => {
    const office = mockOffice();
    let finish!: (result: { status: string; value?: boolean }) => void;
    office.devicePermission.requestPermissionsAsync.mockImplementation(
      (_permissions, callback) => {
        finish = callback;
      },
    );
    const policy = createOfficeAudioAccess({
      host: "Outlook",
      supported: true,
      beforeReload: vi.fn(),
    });
    const first = policy.beforeCapture();
    const second = policy.beforeCapture();
    expect(
      office.devicePermission.requestPermissionsAsync,
    ).toHaveBeenCalledTimes(1);
    expect(policy.canEnumerateDevices()).toBe(false);
    finish({ status: "succeeded", value: false });
    await Promise.all([first, second]);
  });

  it("does not reload or open capture if draft storage fails, including on retry", async () => {
    const office = mockOffice();
    office.devicePermission.requestPermissions.mockResolvedValueOnce(true);
    const reload = vi.fn();
    const policy = createOfficeAudioAccess({
      host: "Word",
      supported: true,
      beforeReload: () => {
        throw new Error("storage unavailable");
      },
      reload,
    });
    await expect(policy.beforeCapture()).rejects.toThrow("storage unavailable");
    await expect(policy.beforeCapture()).rejects.toThrow("storage unavailable");
    expect(reload).not.toHaveBeenCalled();
    expect(policy.canEnumerateDevices()).toBe(false);
    expect(office.devicePermission.requestPermissions).toHaveBeenCalledTimes(1);
  });
});
