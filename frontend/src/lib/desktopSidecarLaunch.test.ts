import { afterEach, describe, expect, it, vi } from "vitest";

import {
  desktopSidecarLaunchUrl,
  windowsDesktopSidecarLaunchScheme,
} from "./desktopSidecarLaunch";

afterEach(() => {
  delete window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME;
  vi.restoreAllMocks();
});

describe("environment-specific sidecar launch", () => {
  it("uses the configured Windows scheme and preserves the default elsewhere", () => {
    window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME = "erato-launch-staging";
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows NT 10.0");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    expect(desktopSidecarLaunchUrl()).toBe("erato-launch-staging://launch");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    expect(desktopSidecarLaunchUrl()).toBe("erato-launch://launch");
  });

  it("accepts URI-safe plain suffixes and rejects invalid suffixes", () => {
    for (const suffix of ["-staging", ".test+1", "a".repeat(64)]) {
      window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME = `erato-launch${suffix}`;
      expect(windowsDesktopSidecarLaunchScheme()).toBe(`erato-launch${suffix}`);
    }
    for (const suffix of ["_staging", "a".repeat(65), "://bad"]) {
      window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME = `erato-launch${suffix}`;
      expect(windowsDesktopSidecarLaunchScheme).toThrow();
    }
  });

  it("defaults to the original scheme and rejects arbitrary executable URLs", () => {
    expect(windowsDesktopSidecarLaunchScheme()).toBe("erato-launch");
    window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME = "https://untrusted.test";
    expect(windowsDesktopSidecarLaunchScheme).toThrow();
  });
});
