export type WordHostPlatform = "PC" | "Mac" | "OfficeOnline" | "unknown";

export function wordHostPlatform(): WordHostPlatform {
  const platform = String(
    globalThis.Office?.context?.diagnostics?.platform ?? "",
  );
  return platform === "PC" || platform === "Mac" || platform === "OfficeOnline"
    ? platform
    : "unknown";
}

/**
 * Whether a comment's range may be read: Comment.getRange(), and anything run on that range. Only
 * PC and Mac are known to leave the document unchanged. On Word for the web it unhides hidden text
 * in the anchored paragraph, and the change is saved (ERMAIN-948 gate F1), so there comments are
 * read and shown through paragraph-level calls only.
 */
export const wordReadsCommentRanges = (platform: WordHostPlatform) =>
  platform === "PC" || platform === "Mac";
