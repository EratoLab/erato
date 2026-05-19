import { isEmlFile, parseEmlToParsedEmail } from "./parseEmlFile";
import { parseMsgFileToParsedEmail } from "./parseMsgFile";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";
import type { ParsedEmail } from "./parsedEmail";

interface ParseDroppedFilesOptions {
  /** Required for `.msg` resolution; the parser goes through Microsoft Graph. */
  acquireGraphToken?: AcquireGraphToken;
  /**
   * Atomic check-and-claim consulted with the RFC 5322 `Message-ID` of each
   * successfully parsed email. Returning `true` keeps the email; `false`
   * drops it as a duplicate.
   */
  tryAttachEmail?: (messageId: string) => boolean;
}

export interface ParseDroppedFilesResult {
  emails: ParsedEmail[];
  nonEmail: File[];
}

/**
 * Splits a dropped batch into staged email payloads and regular files.
 * Used at the dropzone boundary so emails can be parked in the staged-email
 * UI (with per-attachment selection) while non-email files go through
 * regular immediate upload.
 */
export async function parseDroppedFiles(
  files: File[],
  options: ParseDroppedFilesOptions = {},
): Promise<ParseDroppedFilesResult> {
  const emails: ParsedEmail[] = [];
  const nonEmail: File[] = [];

  for (const file of files) {
    if (isEmlFile(file)) {
      const parsed = await parseEmlToParsedEmail(file);
      if (parsed && !claim(parsed.messageId, options.tryAttachEmail)) {
        logSkip(file.name, parsed.messageId);
        continue;
      }
      if (parsed) {
        emails.push(parsed);
      }
      continue;
    }

    if (isMsgFile(file)) {
      if (!options.acquireGraphToken) {
        console.warn(
          "[parseDroppedFiles] .msg drop received without a Graph token — skipping",
          file.name,
        );
        continue;
      }
      const result = await parseMsgFileToParsedEmail(
        file,
        options.acquireGraphToken,
      );
      if (result.parsed && !claim(result.messageId, options.tryAttachEmail)) {
        logSkip(file.name, result.messageId);
        continue;
      }
      if (result.parsed) {
        emails.push(result.parsed);
      }
      continue;
    }

    nonEmail.push(file);
  }

  return { emails, nonEmail };
}

function isMsgFile(file: File): boolean {
  if (file.type === "application/vnd.ms-outlook") {
    return true;
  }
  return file.name.toLowerCase().endsWith(".msg");
}

function claim(
  messageId: string | null,
  tryAttachEmail: ((messageId: string) => boolean) | undefined,
): boolean {
  if (!messageId || !tryAttachEmail) {
    return true;
  }
  return tryAttachEmail(messageId);
}

function logSkip(fileName: string, messageId: string | null): void {
  console.log(
    "[parseDroppedFiles] skipping dropped email already represented in the staged list:",
    fileName,
    messageId,
  );
}
