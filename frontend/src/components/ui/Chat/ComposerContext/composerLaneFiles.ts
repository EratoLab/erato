import type { ComposerContextItem } from "./types";

/** Only an item that says it sends its files (included, or loading) may hide them. */
const sendsItsFiles = (item: ComposerContextItem) =>
  item.state === "included" || item.state === "loading";

export const claimedFileIdsOf = (
  items: readonly ComposerContextItem[] | undefined,
): Set<string> => {
  const ids = new Set<string>();
  for (const item of items ?? []) {
    if (!sendsItsFiles(item)) {
      continue;
    }
    for (const fileId of item.claimsFileIds ?? []) {
      ids.add(fileId);
    }
  }
  return ids;
};

export const unclaimedFiles = <T extends { id: string }>(
  files: T[],
  claimed: ReadonlySet<string>,
): T[] =>
  claimed.size === 0 ? files : files.filter((file) => !claimed.has(file.id));

/** What the included items add to the token estimate. */
export const includedEstimatesOf = (
  items: readonly ComposerContextItem[] | undefined,
): File[] =>
  (items ?? []).flatMap((item) =>
    item.state === "included" && item.estimate ? [item.estimate] : [],
  );

/** The included estimates the send uploads as files of their own. */
export const includedUploadsOf = (
  items: readonly ComposerContextItem[] | undefined,
): File[] =>
  (items ?? []).flatMap((item) =>
    item.state === "included" && item.estimateUpload && item.estimate
      ? [item.estimate]
      : [],
  );
