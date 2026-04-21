import { isEmlFile, parseEmlFileToFiles } from "./parseEmlFile";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";

interface ExpandDroppedEmailFilesOptions {
  /**
   * Required for `.msg` expansion — `.msg` lookup goes through Microsoft
   * Graph and therefore needs a MSAL NAA `Mail.Read` token. Safe to omit if
   * the caller only ever drops `.eml` / regular files.
   */
  acquireGraphToken?: AcquireGraphToken;
  /**
   * Atomic claim consulted with the RFC 5322 `Message-ID` of each
   * successfully parsed email. Returning `true` claims the email and
   * includes it in the output; returning `false` drops it (already
   * attached). Implementations must be atomic — two concurrent calls with
   * the same id must produce one `true` and one `false` (see
   * `useEmailDedupSet#tryAdd`). The check-and-claim are unified into a
   * single callback specifically to close the cross-await race that arose
   * from a separate `shouldSkip` + `onAttached` pair.
   */
  tryAttachEmail?: (messageId: string) => boolean;
}

/**
 * Expands dropped email files into their constituent body + attachment files
 * before they are handed to the upload pipeline. Non-email files are passed
 * through unchanged, so this wrapper is safe to apply to arbitrary dropzone
 * input.
 *
 * `.eml` is parsed locally via postal-mime. `.msg` resolution is deferred to
 * `./parseMsgFile.ts` (Graph lookup by RFC 5322 Message-ID), which requires
 * the `acquireGraphToken` option.
 */
export async function expandDroppedEmailFiles(
  files: File[],
  options: ExpandDroppedEmailFilesOptions = {},
): Promise<File[]> {
  const expanded: File[] = [];
  for (const file of files) {
    if (isEmlFile(file)) {
      const { files: parsed, messageId } = await parseEmlFileToFiles(file);
      if (
        messageId &&
        parsed.length > 0 &&
        options.tryAttachEmail &&
        !options.tryAttachEmail(messageId)
      ) {
        logSkip(file.name, messageId);
        continue;
      }
      expanded.push(...parsed);
      continue;
    }

    if (isMsgFile(file)) {
      const parsed = await parseMsgFileIfPossible(file, options);
      expanded.push(...parsed);
      continue;
    }

    expanded.push(file);
  }
  return expanded;
}

function isMsgFile(file: File): boolean {
  if (file.type === "application/vnd.ms-outlook") {
    return true;
  }
  return file.name.toLowerCase().endsWith(".msg");
}

async function parseMsgFileIfPossible(
  file: File,
  options: ExpandDroppedEmailFilesOptions,
): Promise<File[]> {
  if (!options.acquireGraphToken) {
    console.warn(
      "[expandDroppedEmailFiles] .msg drop received without a Graph token — skipping",
      file.name,
    );
    return [];
  }
  const { parseMsgFileToFiles } = await import("./parseMsgFile");
  const { files, messageId } = await parseMsgFileToFiles(
    file,
    options.acquireGraphToken,
  );
  if (
    messageId &&
    files.length > 0 &&
    options.tryAttachEmail &&
    !options.tryAttachEmail(messageId)
  ) {
    logSkip(file.name, messageId);
    return [];
  }
  return files;
}

function logSkip(fileName: string, messageId: string | null): void {
  console.log(
    "[expandDroppedEmailFiles] skipping dropped email already represented by the current-email preview:",
    fileName,
    messageId,
  );
}
