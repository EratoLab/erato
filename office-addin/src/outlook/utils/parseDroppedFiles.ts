import { isEmlFile, parseEmlToParsedEmail } from "./parseEmlFile";
import { readMsgFile, resolveMsgRead } from "./parseMsgFile";
import { mapWithConcurrency } from "../../utils/mapWithConcurrency";
import { yieldToRenderer } from "../../utils/yieldToRenderer";

import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type { MsgRead } from "./parseMsgFile";
import type { ParsedEmail } from "./parsedEmail";

const MSG_RESOLVE_CONCURRENCY = 4;

export interface ParseDroppedFilesProgress {
  stage: "reading" | "resolving";
  /** 1-based position within the stage. */
  index: number;
  /** Email files in the stage: every email while reading, `.msg` files while resolving. */
  total: number;
  name: string;
}

interface ParseDroppedFilesOptions {
  /**
   * Required for `.msg` resolution; the parser resolves the message through
   * the environment's mail backend. `.eml` drops parse locally and work
   * without it.
   */
  fetcher?: OutlookMessageFetcher;
  /**
   * Atomic check-and-claim consulted with the RFC 5322 `Message-ID` of each
   * successfully parsed email, in input order. Returning `true` keeps the
   * email; `false` drops it as a duplicate.
   */
  tryAttachEmail?: (messageId: string) => boolean;
  /** Called before each unit of work, so the UI can show what is running. */
  onProgress?: (progress: ParseDroppedFilesProgress) => void;
}

export interface ParseDroppedFilesResult {
  emails: ParsedEmail[];
  nonEmail: File[];
}

interface EmailUnit {
  file: File;
  kind: "eml" | "msg";
  parsed: ParsedEmail | null;
  messageId: string | null;
  read: MsgRead | null;
}

/**
 * Splits a dropped batch into staged email payloads and regular files.
 * Used at the dropzone boundary so emails can be parked in the staged-email
 * UI (with per-attachment selection) while non-email files go through
 * regular immediate upload.
 *
 * Two passes: a sequential local read of every email, then the `.msg`
 * mailbox lookups a few at a time. Results keep input order throughout.
 */
export async function parseDroppedFiles(
  files: File[],
  options: ParseDroppedFilesOptions = {},
): Promise<ParseDroppedFilesResult> {
  const nonEmail: File[] = [];
  const units: EmailUnit[] = [];

  for (const file of files) {
    if (isEmlFile(file)) {
      units.push({
        file,
        kind: "eml",
        parsed: null,
        messageId: null,
        read: null,
      });
    } else if (isMsgFile(file)) {
      if (!options.fetcher) {
        console.warn(
          "[parseDroppedFiles] .msg drop received without a message fetcher — skipping",
          file.name,
        );
        continue;
      }
      units.push({
        file,
        kind: "msg",
        parsed: null,
        messageId: null,
        read: null,
      });
    } else {
      nonEmail.push(file);
    }
  }

  for (const [index, unit] of units.entries()) {
    options.onProgress?.({
      stage: "reading",
      index: index + 1,
      total: units.length,
      name: unit.file.name,
    });
    await yieldToRenderer();
    if (unit.kind === "eml") {
      unit.parsed = await parseEmlToParsedEmail(unit.file);
      unit.messageId = unit.parsed?.messageId ?? null;
    } else {
      unit.read = await readMsgFile(unit.file);
    }
  }

  const fetcher = options.fetcher;
  const toResolve = units.flatMap((unit) =>
    unit.read ? [{ unit, read: unit.read }] : [],
  );
  if (fetcher && toResolve.length > 0) {
    await mapWithConcurrency(
      toResolve,
      MSG_RESOLVE_CONCURRENCY,
      async ({ unit, read }, index) => {
        options.onProgress?.({
          stage: "resolving",
          index: index + 1,
          total: toResolve.length,
          name: unit.file.name,
        });
        await yieldToRenderer();
        const result = await resolveMsgRead(read, fetcher, unit.file.name);
        unit.parsed = result.parsed;
        unit.messageId = result.messageId;
      },
    );
  }

  const emails: ParsedEmail[] = [];
  for (const unit of units) {
    if (!unit.parsed) continue;
    if (!claim(unit.messageId, options.tryAttachEmail)) {
      logSkip(unit.file.name, unit.messageId);
      continue;
    }
    emails.push(unit.parsed);
  }

  return { emails, nonEmail };
}

/**
 * Whether the drop handler stages this file as an email rather than uploading
 * it (`.msg` needs a fetcher). Staged emails are trimmable, so they skip the size gate.
 */
export function isExpandableEmailFile(
  file: File,
  options: { hasFetcher: boolean },
): boolean {
  return isEmlFile(file) || (options.hasFetcher && isMsgFile(file));
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
