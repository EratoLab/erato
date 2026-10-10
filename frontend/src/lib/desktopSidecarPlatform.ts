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

export type DesktopSidecarArchitectureHints = {
  /** `navigator.userAgentData` high-entropy `architecture`: "arm" or "x86". */
  clientHintArchitecture?: string;
  webglRenderer?: string;
  webglExtensions?: readonly string[];
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
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

  // Mac browsers report "MacIntel" and "Intel Mac OS X" on Apple Silicon too.
  const architecture = /aarch64|arm64|windows arm|linux arm/.test(client)
    ? "aarch64"
    : /x86_64|x86-64|amd64|x64|win64/.test(client)
      ? "x86_64"
      : undefined;

  return { os, architecture };
}

export function architectureFromHints(
  os: string | undefined,
  hints: DesktopSidecarArchitectureHints,
): string | undefined {
  switch (hints.clientHintArchitecture) {
    case "arm":
      return "aarch64";
    case "x86":
      return "x86_64";
  }
  if (os !== "macos") {
    return undefined;
  }
  const renderer = hints.webglRenderer ?? "";
  if (/\bapple m\d/i.test(renderer)) {
    return "aarch64";
  }
  if (/intel|amd|radeon|nvidia/i.test(renderer)) {
    return "x86_64";
  }
  // Safari masks the renderer as "Apple GPU"; only Apple-family GPUs decode ASTC.
  if (hints.webglExtensions?.includes("WEBGL_compressed_texture_astc")) {
    return "aarch64";
  }
  return undefined;
}

async function readArchitectureHints(
  os: string | undefined,
): Promise<DesktopSidecarArchitectureHints> {
  const hints: DesktopSidecarArchitectureHints = {};
  try {
    const values = await (
      window.navigator as NavigatorWithUserAgentData
    ).userAgentData?.getHighEntropyValues(["architecture"]);
    hints.clientHintArchitecture = values?.architecture;
  } catch {
    // Client hints are optional; fall through to the other signals.
  }
  if (os === "macos" && !hints.clientHintArchitecture) {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      if (gl && debug) {
        hints.webglRenderer = String(
          gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        );
      }
      hints.webglExtensions = gl?.getSupportedExtensions() ?? undefined;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // No WebGL: the architecture stays unknown.
    }
  }
  return hints;
}

export async function detectDesktopSidecarArchitecture(
  client: DesktopSidecarClientPlatform,
): Promise<string | undefined> {
  return (
    architectureFromHints(client.os, await readArchitectureHints(client.os)) ??
    client.architecture
  );
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
  // Macs sold since 2023 are all Apple Silicon.
  const fallbackArchitecture = client.os === "macos" ? "aarch64" : "x86_64";

  return (
    (client.architecture
      ? candidates.find(
          (target) => target.platform.architecture === client.architecture,
        )
      : undefined) ??
    candidates.find(
      (target) => target.platform.architecture === fallbackArchitecture,
    ) ??
    candidates.find((target) => target.platform.architecture === "x86_64") ??
    candidates[0]
  );
}

export function isDesktopSidecarTargetForClient(
  target: DesktopSidecarTargetLike,
  client: DesktopSidecarClientPlatform,
): boolean {
  return (
    client.architecture !== undefined &&
    target.platform.os === client.os &&
    target.platform.architecture === client.architecture
  );
}
