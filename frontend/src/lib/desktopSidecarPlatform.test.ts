import {
  architectureFromHints,
  detectDesktopSidecarClientPlatform,
  isDesktopSidecarTargetForClient,
  selectBestDesktopSidecarTarget,
} from "./desktopSidecarPlatform";

const targets = [
  {
    id: "windows-x86_64",
    platform: { os: "windows", architecture: "x86_64" },
  },
  {
    id: "windows-aarch64",
    platform: { os: "windows", architecture: "aarch64" },
  },
  {
    id: "macos-x86_64",
    platform: { os: "macos", architecture: "x86_64" },
  },
  {
    id: "macos-aarch64",
    platform: { os: "macos", architecture: "aarch64" },
  },
  {
    id: "linux-x86_64-gnu",
    platform: { os: "linux", architecture: "x86_64" },
  },
];

describe("desktop sidecar platform selection", () => {
  it("detects the operating system and architecture from desktop clients", () => {
    expect(
      detectDesktopSidecarClientPlatform(
        "Mozilla/5.0 (Windows NT 10.0; ARM64)",
        "Win32",
      ),
    ).toEqual({ os: "windows", architecture: "aarch64" });
    expect(
      detectDesktopSidecarClientPlatform(
        "Mozilla/5.0 (X11; Linux x86_64)",
        "Linux x86_64",
      ),
    ).toEqual({ os: "linux", architecture: "x86_64" });
    expect(
      detectDesktopSidecarClientPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "MacIntel",
      ),
    ).toEqual({ os: "macos", architecture: undefined });
  });

  it("reads the architecture from client hints and, on a Mac, from WebGL", () => {
    expect(
      architectureFromHints("windows", { clientHintArchitecture: "arm" }),
    ).toBe("aarch64");
    expect(
      architectureFromHints("macos", {
        clientHintArchitecture: "x86",
        webglRenderer: "Apple M2",
      }),
    ).toBe("x86_64");
    expect(
      architectureFromHints("macos", {
        webglRenderer:
          "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)",
      }),
    ).toBe("aarch64");
    expect(
      architectureFromHints("macos", {
        webglRenderer: "Intel(R) Iris(TM) Plus Graphics 655",
        webglExtensions: ["WEBGL_compressed_texture_astc"],
      }),
    ).toBe("x86_64");
    expect(
      architectureFromHints("macos", {
        webglRenderer: "Apple GPU",
        webglExtensions: ["WEBGL_compressed_texture_astc"],
      }),
    ).toBe("aarch64");
    expect(
      architectureFromHints("macos", {
        webglRenderer: "Apple GPU",
        webglExtensions: ["WEBGL_compressed_texture_s3tc"],
      }),
    ).toBeUndefined();
    expect(
      architectureFromHints("windows", { webglRenderer: "Apple M1" }),
    ).toBeUndefined();
  });

  it("does not recommend desktop artifacts to mobile clients", () => {
    expect(
      detectDesktopSidecarClientPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        "iPhone",
      ),
    ).toEqual({ os: undefined, architecture: undefined });
  });

  it("prefers an exact platform match and otherwise falls back within the OS", () => {
    expect(
      selectBestDesktopSidecarTarget(targets, {
        os: "windows",
        architecture: "aarch64",
      })?.id,
    ).toBe("windows-aarch64");
    expect(
      selectBestDesktopSidecarTarget(targets, {
        os: "linux",
        architecture: "aarch64",
      })?.id,
    ).toBe("linux-x86_64-gnu");
  });

  it("defaults an undetected Mac to Apple Silicon without recommending it", () => {
    const client = { os: "macos", architecture: undefined };
    const target = selectBestDesktopSidecarTarget(targets, client);

    expect(target?.id).toBe("macos-aarch64");
    expect(isDesktopSidecarTargetForClient(target!, client)).toBe(false);
    expect(
      isDesktopSidecarTargetForClient(target!, {
        os: "macos",
        architecture: "aarch64",
      }),
    ).toBe(true);
  });
});
