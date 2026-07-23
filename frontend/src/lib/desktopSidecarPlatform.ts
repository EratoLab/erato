/* eslint-disable lingui/no-unlocalized-strings */

export type DesktopSidecarClientPlatform = {
  os?: string;
  architecture?: string;
};

export type DesktopSidecarTargetLike = {
  id: string;
  platform: {
    os: string;
    architecture: string;
  };
};

export function detectDesktopSidecarClientPlatform(
  userAgent: string,
  navigatorPlatform = "",
): DesktopSidecarClientPlatform {
  const client = `${navigatorPlatform} ${userAgent}`.toLowerCase();

  const os = /iphone|ipad|android/.test(client)
    ? undefined
    : /windows|win32|win64/.test(client)
      ? "windows"
      : /macintosh|mac os|macintel/.test(client)
        ? "macos"
        : /linux|x11|cros/.test(client)
          ? "linux"
          : undefined;

  const architecture = /aarch64|arm64|windows arm|linux arm/.test(client)
    ? "aarch64"
    : /x86_64|x86-64|amd64|x64|win64|macintel/.test(client)
      ? "x86_64"
      : undefined;

  return { os, architecture };
}

export function selectBestDesktopSidecarTarget<
  Target extends DesktopSidecarTargetLike,
>(
  targets: readonly Target[],
  client: DesktopSidecarClientPlatform,
): Target | undefined {
  if (targets.length === 0) {
    return undefined;
  }

  const matchingOs = client.os
    ? targets.filter((target) => target.platform.os === client.os)
    : [];
  const candidates = matchingOs.length > 0 ? matchingOs : targets;

  return (
    (client.architecture
      ? candidates.find(
          (target) => target.platform.architecture === client.architecture,
        )
      : undefined) ??
    candidates.find((target) => target.platform.architecture === "x86_64") ??
    candidates[0]
  );
}
