import type { ComposerSizeLimit } from "../ChatInput";

export interface ComposerSendPart {
  name: string;
  size: number;
}

/** The staged side: a file whose size the upload reported, or not. */
export interface ComposerStagedFile {
  filename: string;
  size?: number;
}

export interface ComposerSendLimits {
  maxBytes: number;
  maxFormatted: string;
  maxFiles: number;
}

/**
 * The first reason a send would be refused: an upload over the per-file limit
 * (each is checked on its own, as the upload does), else more files than one
 * message may carry. Staged files without a known size pass the size check.
 */
export function findComposerSendLimit(
  uploads: readonly ComposerSendPart[],
  stagedFiles: readonly ComposerStagedFile[],
  limits: ComposerSendLimits,
): ComposerSizeLimit | null {
  const oversized = [
    ...uploads
      .filter((upload) => upload.size > limits.maxBytes)
      .map((upload) => upload.name),
    ...stagedFiles.flatMap((file) =>
      file.size !== undefined && file.size > limits.maxBytes
        ? [file.filename]
        : [],
    ),
  ];
  if (oversized.length > 0) {
    return { names: oversized, formatted: limits.maxFormatted, kind: "size" };
  }
  if (uploads.length + stagedFiles.length > limits.maxFiles) {
    return { names: [], formatted: String(limits.maxFiles), kind: "count" };
  }
  return null;
}
