const CLIPBOARD_IMAGE_FILENAME_PATTERN = /^image\.(png|jpg)$/i;
const NUMBERED_IMAGE_FILENAME_PATTERN = /^image(\d+)\.(png|jpg)$/i;

function getImageExtension(filename: string): string | null {
  const match = filename.match(CLIPBOARD_IMAGE_FILENAME_PATTERN);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Gives clipboard-generated image filenames stable, unique names.
 *
 * Browsers commonly name pasted image files `image.png` or `image.jpg`.
 * Existing names are considered so numbering continues across uploads.
 */
export function disambiguatePastedImageFileNames(
  files: File[],
  existingFileNames: readonly string[],
): File[] {
  const highestNumberByExtension = new Map<string, number>();

  for (const filename of existingFileNames) {
    const clipboardImageExtension = getImageExtension(filename);
    if (clipboardImageExtension) {
      highestNumberByExtension.set(
        clipboardImageExtension,
        Math.max(highestNumberByExtension.get(clipboardImageExtension) ?? 0, 0),
      );
      continue;
    }

    const numberedMatch = filename.match(NUMBERED_IMAGE_FILENAME_PATTERN);
    if (!numberedMatch) {
      continue;
    }

    const extension = numberedMatch[2].toLowerCase();
    const number = Number(numberedMatch[1]);
    highestNumberByExtension.set(
      extension,
      Math.max(highestNumberByExtension.get(extension) ?? 0, number),
    );
  }

  return files.map((file) => {
    const extension = getImageExtension(file.name);
    if (!extension) {
      return file;
    }

    const nextNumber = (highestNumberByExtension.get(extension) ?? 0) + 1;
    highestNumberByExtension.set(extension, nextNumber);

    return new File([file], `image${nextNumber}.${extension}`, {
      lastModified: file.lastModified,
      type: file.type,
    });
  });
}
