export type WordHostPlatform = "PC" | "Mac" | "OfficeOnline" | "unknown";

export function wordHostPlatform(): WordHostPlatform {
  const platform = String(
    globalThis.Office?.context?.diagnostics?.platform ?? "",
  );
  return platform === "PC" || platform === "Mac" || platform === "OfficeOnline"
    ? platform
    : "unknown";
}
