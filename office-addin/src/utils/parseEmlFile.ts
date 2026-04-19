import PostalMime from "postal-mime";

import { buildEmailBodyFile } from "./buildEmailBodyHtml";

import type { Address, Mailbox } from "postal-mime";

/**
 * Expands `.eml` files (MIME `message/rfc822`) into an HTML body file and
 * separate attachment files, mirroring the shape produced by
 * `fetchOutlookMessage.ts` for the OWA `maillistrow` drag path. The backend
 * rejects raw `.eml` uploads because `message/rfc822` is not a declared file
 * capability, so we parse them client-side before forwarding to upload.
 */

export function isEmlFile(file: File): boolean {
  if (file.type === "message/rfc822") {
    return true;
  }
  return /\.eml$/i.test(file.name);
}

export async function parseEmlFileToFiles(file: File): Promise<File[]> {
  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = await PostalMime.parse(buffer);
  } catch (error) {
    console.warn("[parseEmlFile] failed to parse .eml file, skipping:", error);
    return [];
  }

  const date = parsed.date ? new Date(parsed.date) : null;
  const bodyFile = buildEmailBodyFile({
    subject: parsed.subject ?? "(no subject)",
    from: toMailbox(parsed.from),
    to: flattenAddresses(parsed.to),
    cc: flattenAddresses(parsed.cc),
    date: date && !isNaN(date.getTime()) ? date : null,
    bodyHtml: parsed.html ?? null,
    bodyText: parsed.text ?? null,
  });

  const attachmentFiles: File[] = [];
  for (const attachment of parsed.attachments ?? []) {
    if (attachment.disposition === "inline" || attachment.related === true) {
      continue;
    }
    const blobPart = toBlobPart(attachment.content);
    if (blobPart === null) {
      continue;
    }
    const filename = attachment.filename?.trim() || "attachment";
    const mimeType = attachment.mimeType || "application/octet-stream";
    attachmentFiles.push(new File([blobPart], filename, { type: mimeType }));
  }

  return [bodyFile, ...attachmentFiles];
}

function toMailbox(
  address: Address | undefined,
): { name?: string; address?: string } | null {
  if (!address) {
    return null;
  }
  if ("address" in address && address.address) {
    return { name: address.name, address: address.address };
  }
  return null;
}

function flattenAddresses(
  addresses: Address[] | undefined,
): { name?: string; address?: string }[] | null {
  if (!addresses || addresses.length === 0) {
    return null;
  }
  const result: Mailbox[] = [];
  for (const entry of addresses) {
    if ("address" in entry && entry.address) {
      result.push({ name: entry.name, address: entry.address });
      continue;
    }
    if ("group" in entry && Array.isArray(entry.group)) {
      for (const member of entry.group) {
        if (member.address) {
          result.push({ name: member.name, address: member.address });
        }
      }
    }
  }
  return result.length > 0 ? result : null;
}

function toBlobPart(
  content: ArrayBuffer | Uint8Array | string,
): BlobPart | null {
  if (typeof content === "string") {
    const encoded = new TextEncoder().encode(content);
    const copy = new Uint8Array(encoded.byteLength);
    copy.set(encoded);
    return copy.buffer;
  }
  if (content instanceof Uint8Array) {
    const copy = new Uint8Array(content.byteLength);
    copy.set(content);
    return copy.buffer;
  }
  if (content instanceof ArrayBuffer) {
    return content;
  }
  return null;
}
