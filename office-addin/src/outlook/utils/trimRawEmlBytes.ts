import { trimEmlAttachments } from "./trimEmlAttachments";

import type { AttachmentTarget } from "./trimEmlAttachments";

/** The dismissed attachments could not be cut out of an email's bytes. */
export class EmailTrimError extends Error {
  constructor(public readonly filename: string) {
    super(`Could not trim dismissed attachments from ${filename}`);
    this.name = "EmailTrimError";
  }
}

/**
 * Mints the trimmed `.eml` as a File named and typed like `like`. The
 * `lastModified` is inherited so remints of the same input digest the same.
 * Null when the structure cannot be cut safely.
 */
export function trimEmlFileSync(
  bytes: Uint8Array,
  like: File,
  targets: AttachmentTarget[],
): File | null {
  const trimmed = trimEmlAttachments(bytes, targets);
  if (!trimmed) {
    return null;
  }
  return new File([trimmed.slice()], like.name, {
    type: like.type,
    lastModified: like.lastModified,
  });
}

/**
 * Cuts dismissed attachments out of a staged email's bytes. Never falls back
 * to the untrimmed file: an email that cannot honour the dismissal is not sent.
 */
export async function trimRawEmlBytes(
  rawEmlFile: File,
  targets: AttachmentTarget[],
): Promise<File> {
  const buffer = await rawEmlFile.arrayBuffer();
  const trimmed = trimEmlFileSync(new Uint8Array(buffer), rawEmlFile, targets);
  if (!trimmed) {
    throw new EmailTrimError(rawEmlFile.name);
  }
  return trimmed;
}
