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

/**
 * Whether adding, editing, resolving, reopening or deleting a comment leaves hidden text hidden.
 * On Word for the web each of them unhides the hidden text of the paragraphs the comment is
 * anchored in, and the change is saved; replies, and their edits and deletes, do not (ERMAIN-949
 * gate W1). There those writes first check their paragraphs.
 */
export const wordCommentWritesKeepHiddenText = (platform: WordHostPlatform) =>
  platform === "PC" || platform === "Mac";

/** Paragraph.getOoxml carries the paragraph's own properties (w:pPr), and with them its paragraph-mark
 * and paragraph-format revisions, only on PC and Mac; Word for the web leaves them out (ERMAIN-967). */
export const wordParagraphOoxmlHasProperties = (platform: WordHostPlatform) =>
  platform === "PC" || platform === "Mac";
