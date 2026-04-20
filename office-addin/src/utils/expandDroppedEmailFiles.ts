import { isEmlFile, parseEmlFileToFiles } from "./parseEmlFile";

import type { AcquireGraphToken } from "./fetchOutlookMessageGraph";

interface ExpandDroppedEmailFilesOptions {
  /**
   * Required for `.msg` expansion — `.msg` lookup goes through Microsoft
   * Graph and therefore needs a MSAL NAA `Mail.Read` token. Safe to omit if
   * the caller only ever drops `.eml` / regular files.
   */
  acquireGraphToken?: AcquireGraphToken;
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
      const parsed = await parseEmlFileToFiles(file);
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
  return parseMsgFileToFiles(file, options.acquireGraphToken);
}
