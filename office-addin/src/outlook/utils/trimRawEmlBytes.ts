import { trimEmlAttachments } from "./trimEmlAttachments";

/** The dismissed attachments could not be cut out of an email's bytes. */
export class EmailTrimError extends Error {
  constructor(public readonly filename: string) {
    super(`Could not trim dismissed attachments from ${filename}`);
    this.name = "EmailTrimError";
  }
}

/**
 * Cuts dismissed attachments out of a staged email's bytes. Never falls back
 * to the untrimmed file: an email that cannot honour the dismissal is not sent.
 */
export async function trimRawEmlBytes(
  rawEmlFile: File,
  indicesToRemove: number[],
): Promise<File> {
  const buffer = await rawEmlFile.arrayBuffer();
  const trimmed = trimEmlAttachments(new Uint8Array(buffer), indicesToRemove);
  if (!trimmed) {
    throw new EmailTrimError(rawEmlFile.name);
  }
  return new File([trimmed.slice()], rawEmlFile.name, {
    type: rawEmlFile.type,
  });
}
