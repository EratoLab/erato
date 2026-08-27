/**
 * Reading a name back out of an upload the Teams picker minted.
 *
 * The picker names what it uploads after the bytes — `teams-file-<hash>-<slug>`
 * for a shared file, `teams-img-<hash>.<ext>` for a pasted image — because that
 * name is the key the backend joins parsed uploads by. It is a join key, not
 * something to read.
 *
 * Wherever the transcript's index block is at hand, prefer the `displayName` it
 * records: that is the name Teams itself gave the file. This is the fallback for
 * surfaces holding only a bare upload — the chip on a sent message, say — where
 * parsing the transcript to name a sibling would be far more work than the name
 * is worth.
 *
 * Approximate by construction: the slug replaced separators and was cut to a
 * length, so `Q3 report.pdf` comes back as `Q3_report.pdf`. That is a fair trade
 * against showing a content hash, and the exact name is one click away inside
 * the conversation view.
 */

import { t } from "@lingui/core/macro";

const IMAGE_UPLOAD = /^teams-img-[0-9a-f]{16}\.([a-z0-9]+)$/;
const FILE_UPLOAD = /^teams-file-[0-9a-f]{8}-(.+)$/;

/** Every transcript name the builder can produce, and nothing else. */
const TRANSCRIPT = /^teams-[^/]*\.md$/;

/**
 * Whether the picker minted this upload — the hex hash makes the pattern
 * specific enough that an ordinary attachment cannot collide with it.
 */
export function isTeamsMintedUpload(filename: string): boolean {
  return IMAGE_UPLOAD.test(filename) || FILE_UPLOAD.test(filename);
}

/**
 * Whether this could be a transcript. Deliberately weaker than the above: the
 * builder derives the name from the conversation title, so the only stable
 * part is the prefix and extension. Never sufficient on its own — see
 * `groupTeamsSentAttachments`.
 */
export function isTeamsTranscriptName(filename: string): boolean {
  return TRANSCRIPT.test(filename) && !isTeamsMintedUpload(filename);
}

/**
 * A readable name for a minted Teams upload, or null for anything this did not
 * mint — an ordinary attachment keeps the name it came with.
 */
export function teamsUploadDisplayName(filename: string): string | null {
  const imageExtension = IMAGE_UPLOAD.exec(filename)?.[1];
  if (imageExtension !== undefined) {
    // A pasted image never had a name of its own, so the composer calls it
    // simply an image and this matches it. The extension is kept because the
    // tile derives its type and size line from the name it is shown.
    const label = t({ id: "chat.attachment.teamsImage", message: "Image" });
    return `${label}.${imageExtension}`;
  }
  const slug = FILE_UPLOAD.exec(filename)?.[1];
  return slug !== undefined && slug.length > 0 ? slug : null;
}
