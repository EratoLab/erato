import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enumerateAudioDevices,
  installAudioCaptureAccessPolicy,
  requestAudioStream,
} from "../audioCaptureAccess";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

function media() {
  return {
    getUserMedia: vi.fn(async () => ({}) as MediaStream),
    enumerateDevices: vi.fn(async () => []),
  } as unknown as MediaDevices;
}

describe("host microphone access boundary", () => {
  it("leaves ordinary browser capture and discovery unchanged", async () => {
    const devices = media();
    await requestAudioStream(devices, { audio: true });
    await enumerateAudioDevices(devices);
    expect(devices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(devices.enumerateDevices).toHaveBeenCalledOnce();
  });

  it("waits for consent, preserves device constraints, and does not prompt on enumeration", async () => {
    let grant!: () => void;
    const beforeCapture = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        }),
    );
    dispose = installAudioCaptureAccessPolicy({
      beforeCapture,
      canEnumerateDevices: () => false,
    });
    const devices = media();
    expect(await enumerateAudioDevices(devices)).toEqual([]);
    expect(beforeCapture).not.toHaveBeenCalled();
    expect(devices.enumerateDevices).not.toHaveBeenCalled();
    const constraints = {
      audio: { deviceId: { exact: "chosen-mic" }, echoCancellation: false },
    };
    const capture = requestAudioStream(devices, constraints);
    expect(devices.getUserMedia).not.toHaveBeenCalled();
    grant();
    await capture;
    expect(devices.getUserMedia).toHaveBeenCalledWith(constraints);
  });

  it.each(["NotAllowedError", "AbortError"])(
    "never captures on consent failure or reload: %s",
    async (name) => {
      dispose = installAudioCaptureAccessPolicy({
        beforeCapture: async () => {
          throw new DOMException("blocked", name);
        },
        canEnumerateDevices: () => false,
      });
      const devices = media();
      await expect(
        requestAudioStream(devices, { audio: true }),
      ).rejects.toMatchObject({ name });
      expect(devices.getUserMedia).not.toHaveBeenCalled();
    },
  );

  it("does not start a pending capture after the host is disposed", async () => {
    let grant!: () => void;
    dispose = installAudioCaptureAccessPolicy({
      beforeCapture: () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        }),
      canEnumerateDevices: () => false,
    });
    const devices = media();
    const capture = requestAudioStream(devices, { audio: true });
    dispose();
    grant();
    await expect(capture).rejects.toMatchObject({ name: "AbortError" });
    expect(devices.getUserMedia).not.toHaveBeenCalled();
  });
});
