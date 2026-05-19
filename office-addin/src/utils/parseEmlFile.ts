import { parseEmlBytes } from "./parsedEmail";

import type { ParsedEmail } from "./parsedEmail";

export interface EmlParseResult {
  files: File[];
  messageId: string | null;
}

export function isEmlFile(file: File): boolean {
  if (file.type === "message/rfc822") {
    return true;
  }
  return /\.eml$/i.test(file.name);
}

/**
 * Phase 1 transitional adapter — flattens a dropped `.eml` into the raw
 * RFC822 file plus one sibling `File` per non-inline, non-related attachment.
 *
 * Branch A (ERMAIN-273) replaces this output with a trimmed single `.eml`
 * via surgical MIME removal — that swap lands in Phase 2. Until then we
 * keep the sibling-upload shape so the existing pipeline keeps working
 * while the selection UI / pre-upload validation is built on top of the
 * new `ParsedEmail` shape.
 */
export async function parseEmlFileToFiles(file: File): Promise<EmlParseResult> {
  const parsed = await parseEmlToParsedEmail(file);
  if (!parsed) {
    return { files: [], messageId: null };
  }

  const attachmentFiles = parsed.attachments
    .filter(
      (attachment) =>
        attachment.disposition !== "inline" && !attachment.related,
    )
    .map((attachment) => attachment.toFile());

  return {
    files: [parsed.rawEmlFile, ...attachmentFiles],
    messageId: parsed.messageId,
  };
}

export async function parseEmlToParsedEmail(
  file: File,
): Promise<ParsedEmail | null> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (error) {
    console.warn("[parseEmlFile] failed to read .eml bytes, skipping:", error);
    return null;
  }
  return parseEmlBytes(buffer, { filename: file.name });
}
