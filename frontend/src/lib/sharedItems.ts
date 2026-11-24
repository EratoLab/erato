import { decodeBase64 } from "@/utils/file/decodeBase64";

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

export const noSharedItems = (): SharedComposerItems => ({
  texts: [],
  files: [],
  filesWithoutContent: [],
});

export function sortSharedItems(result: unknown): SharedComposerItems {
  const sorted = noSharedItems();
  const texts: { text: string; isUrl: boolean }[] = [];
  for (const item of sharedItemsOf(result)) {
    if (item.kind === "url" && typeof item.url === "string") {
      texts.push({ text: item.url.trim(), isUrl: true });
    } else if (item.kind === "text" && typeof item.text === "string") {
      texts.push({ text: item.text.trim(), isUrl: false });
    } else if (item.kind === "file" && typeof item.fileName === "string") {
      const size = typeof item.size === "number" ? item.size : 0;
      const bytes =
        typeof item.data === "string" ? decodeBase64(item.data) : undefined;
      if (bytes) {
        sorted.files.push(
          new File([bytes], item.fileName, {
            type: typeof item.contentType === "string" ? item.contentType : "",
          }),
        );
      } else {
        sorted.filesWithoutContent.push({ name: item.fileName, size });
      }
    }
  }
  // A page shared from a browser can come as its address and as text that
  // already contains it; the message field shows it once.
  const words = new Set(
    texts.filter((t) => !t.isUrl).flatMap((t) => t.text.split(/\s+/)),
  );
  for (const { text, isUrl } of texts) {
    if (!text || sorted.texts.includes(text) || (isUrl && words.has(text))) {
      continue;
    }
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

function isRecord(value: unknown): value is LooseItem {
  return typeof value === "object" && value !== null;
}
