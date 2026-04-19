import { isEmlFile, parseEmlFileToFiles } from "./parseEmlFile";

/**
 * Expands dropped `.eml` files into their constituent body + attachment
 * files before they are handed to the upload pipeline. Non-`.eml` files are
 * passed through unchanged so this wrapper is safe to apply to arbitrary
 * dropzone input. `.msg` files are intentionally untouched — their parsing
 * strategy is handled separately.
 */
export async function expandDroppedEmailFiles(
  files: File[],
): Promise<File[]> {
  const expanded: File[] = [];
  for (const file of files) {
    if (isEmlFile(file)) {
      const parsed = await parseEmlFileToFiles(file);
      expanded.push(...parsed);
      continue;
    }
    expanded.push(file);
  }
  return expanded;
}
