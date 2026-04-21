import PostalMime from "postal-mime";

/**
 * Expands a dropped `.eml` file into the raw RFC822 message (uploaded as
 * `message/rfc822` so the backend can extract headers and body server-side)
 * plus one `File` per non-inline, non-related attachment. Attachments are
 * extracted client-side because the backend's `.eml` text extraction lists
 * attachment filenames only, not their contents.
 *
 * The RFC 5322 `Message-ID` header is returned alongside the files so the
 * caller can correlate this drop against other representations of the same
 * email (e.g. the currently-open email preview) and avoid duplicates.
 */

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

export async function parseEmlFileToFiles(file: File): Promise<EmlParseResult> {
  let buffer: ArrayBuffer;
  let parsed;
  try {
    buffer = await file.arrayBuffer();
    parsed = await PostalMime.parse(buffer);
  } catch (error) {
    console.warn("[parseEmlFile] failed to parse .eml file, skipping:", error);
    return { files: [], messageId: null };
  }

  const rawEmlFile = new File([buffer], file.name, {
    type: "message/rfc822",
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

  return {
    files: [rawEmlFile, ...attachmentFiles],
    messageId: parsed.messageId ?? null,
  };
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
