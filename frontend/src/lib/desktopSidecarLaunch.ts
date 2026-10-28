/* eslint-disable lingui/no-unlocalized-strings -- OS protocol identifiers. */
import { detectDesktopSidecarClientPlatform } from "./desktopSidecarPlatform";

declare global {
  interface Window {
    DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME?: string;
  }
}

export function windowsDesktopSidecarLaunchScheme(): string {
  const scheme = window.DESKTOP_SIDECAR_WINDOWS_LAUNCH_SCHEME ?? "erato-launch";
  if (!/^erato-launch[a-z0-9.+-]{0,64}$/.test(scheme)) {
    throw new Error("Invalid desktop sidecar launch scheme");
  }
  return scheme;
}

export function desktopSidecarLaunchUrl(): string {
  const { os } = detectDesktopSidecarClientPlatform(
    navigator.userAgent,
    navigator.platform,
  );
  const scheme =
    os === "windows" ? windowsDesktopSidecarLaunchScheme() : "erato-launch";
  return `${scheme}://launch`;
}
