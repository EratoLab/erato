/**
 * Items people shared into the app from other apps, as the host shell's
 * `share.takePending` returns them, sorted into what the composer takes:
 * text for the message field, files to upload, and files that arrived
 * without their content.
 */
export interface SharedComposerItems {
  texts: string[];
  files: File[];
  filesWithoutContent: { name: string; size: number }[];
}

export function sortSharedItems(result: unknown): SharedComposerItems {
  const sorted: SharedComposerItems = {
    texts: [],
    files: [],
    filesWithoutContent: [],
  };
  const texts: { text: string; isUrl: boolean }[] = [];
  for (const item of sharedItemsOf(result)) {
    if (item.kind === "url" && typeof item.url === "string") {
      texts.push({ text: item.url.trim(), isUrl: true });
    } else if (item.kind === "text" && typeof item.text === "string") {
      texts.push({ text: item.text.trim(), isUrl: false });
    } else if (item.kind === "file" && typeof item.fileName === "string") {
      if (typeof item.data === "string") {
        const file = decodeFile(item.data, item.fileName, item.contentType);
        if (file) sorted.files.push(file);
      } else {
        const size = typeof item.size === "number" ? item.size : 0;
        sorted.filesWithoutContent.push({ name: item.fileName, size });
      }
    }
  }
  // A page shared from a browser can come as its address and as text that
  // already contains it; the message field shows it once.
  const seen = new Set<string>();
  for (const { text, isUrl } of texts) {
    if (!text || seen.has(text)) continue;
    if (
      isUrl &&
      texts.some((other) => !other.isUrl && other.text.includes(text))
    )
      continue;
    seen.add(text);
    sorted.texts.push(text);
  }
  return sorted;
}

type LooseItem = Record<string, unknown>;

function sharedItemsOf(result: unknown): LooseItem[] {
  const batches = isRecord(result) ? result.batches : undefined;
  if (!Array.isArray(batches)) return [];
  return batches.flatMap((batch) =>
    isRecord(batch) && Array.isArray(batch.items)
      ? batch.items.filter(isRecord)
      : [],
  );
}

function decodeFile(
  base64: string,
  fileName: string,
  contentType: unknown,
): File | null {
  let binary: string;
  try {
    binary = window.atob(base64);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], fileName, {
    type: typeof contentType === "string" ? contentType : "",
  });
}

function isRecord(value: unknown): value is LooseItem {
  return typeof value === "object" && value !== null;
}
