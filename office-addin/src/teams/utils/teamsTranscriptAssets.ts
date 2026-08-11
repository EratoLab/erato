/**
 * Turns what selected Teams messages carry — pasted images, shared files —
 * into upload files, and stamps each message's marker with the uploaded name.
 * That name is how the model joins file ↔ message: the backend keys parsed
 * uploads by filename and the marker sits at the exact message position.
 *
 * Everything degrades to the bare marker: a failed fetch, a missing file
 * grant or the caps leave `[image]` / `[attachment: …]` exactly as they read
 * today. The one exception speaks up — a file refused for size is stamped
 * "too large to attach", because silence there would read as an oversight.
 */

import { runWithConcurrency } from "../../utils/graph/graphClient";

import type { TeamsTranscriptSection } from "./buildTeamsTranscriptFile";
import type { ParsedTeamsMessage, TeamsSharedFileRef } from "./parsedTeamsChat";
import type { TeamsHostedContent } from "./teamsChatGraph";
import type { TeamsSharedFileDownload } from "./teamsSharedFilesGraph";

/** Vision input is expensive; a transcript is an excerpt, not an album. */
export const MAX_TRANSCRIPT_IMAGES = 10;
/** Pasted screenshots are small; anything bigger is not worth the tokens. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TRANSCRIPT_FILES = 10;
/**
 * Fallback per-file cap for when the deployment's configured upload limit is
 * not available — normally the backend's own `max_upload_size_kb` governs.
 */
export const MAX_SHARED_FILE_BYTES = 10 * 1024 * 1024;
/** Ceiling across all shared files, so ten maximal ones can't stack up. */
export const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024;
/** Same-conversation fetches serialize on the gate anyway. */
const ASSET_FETCH_CONCURRENCY = 3;

export type FetchTeamsImage = (
  section: TeamsTranscriptSection,
  url: string,
) => Promise<TeamsHostedContent | null>;

export type DownloadTeamsFile = (
  ref: TeamsSharedFileRef,
  maxBytes: number,
) => Promise<TeamsSharedFileDownload>;

export interface TeamsAssetsResult {
  /** The input sections with fetched assets stamped into their markers. */
  sections: TeamsTranscriptSection[];
  files: File[];
}

/** Fetches the plan will attempt — the progress denominator. */
export function planTeamsAssetFetches(
  sections: readonly TeamsTranscriptSection[],
  canFetchFiles: boolean,
): number {
  return (
    imageFetchPlan(sections).length +
    (canFetchFiles ? fileFetchPlan(sections).length : 0)
  );
}

export async function collectTeamsMessageAssets(args: {
  sections: readonly TeamsTranscriptSection[];
  fetchImage: FetchTeamsImage;
  /** Null when `Files.Read.All` was not granted — file markers stay bare. */
  downloadFile: DownloadTeamsFile | null;
  /** The deployment's upload limit; what the backend would refuse anyway. */
  maxFileBytes?: number;
  /** Called exactly once per planned fetch, success or not. */
  onFetched?: () => void;
  signal?: AbortSignal;
}): Promise<TeamsAssetsResult> {
  const uploadedImageByUrl = new Map<string, string>();
  const uploadedFileByUrl = new Map<string, string>();
  const tooLargeFileUrls = new Set<string>();
  const filesByHash = new Map<string, File>();
  const maxFileBytes = args.maxFileBytes ?? MAX_SHARED_FILE_BYTES;
  // The total budget must never undercut a single file the deployment allows.
  const totalFileBudget = Math.max(MAX_TOTAL_FILE_BYTES, maxFileBytes);
  let fileBudgetUsed = 0;

  const imageTasks = imageFetchPlan(args.sections).map(
    (planned) => async () => {
      try {
        if (args.signal?.aborted) return;
        const content = await args.fetchImage(planned.section, planned.url);
        if (!content) return;
        const size = content.bytes.byteLength;
        if (size === 0 || size > MAX_IMAGE_BYTES) return;
        const hash = fnv1a64Hex(content.bytes);
        let file = filesByHash.get(hash);
        if (!file) {
          file = new File(
            [content.bytes],
            `teams-img-${hash}.${imageExtension(content.contentType)}`,
            { type: content.contentType },
          );
          filesByHash.set(hash, file);
        }
        uploadedImageByUrl.set(planned.url, file.name);
      } catch {
        // One asset failing must not sink the transcript.
      } finally {
        args.onFetched?.();
      }
    },
  );

  const downloadFile = args.downloadFile;
  const fileTasks = downloadFile
    ? fileFetchPlan(args.sections).map((ref) => async () => {
        try {
          if (args.signal?.aborted) return;
          const remaining = totalFileBudget - fileBudgetUsed;
          if (remaining <= 0) {
            tooLargeFileUrls.add(ref.contentUrl);
            return;
          }
          const result = await downloadFile(
            ref,
            Math.min(maxFileBytes, remaining),
          );
          if (result.state === "too-large") {
            tooLargeFileUrls.add(ref.contentUrl);
            return;
          }
          if (result.state !== "ok") return;
          fileBudgetUsed += result.content.bytes.byteLength;
          const hash = fnv1a64Hex(result.content.bytes);
          let file = filesByHash.get(hash);
          if (!file) {
            file = new File(
              [result.content.bytes],
              `teams-file-${hash.slice(0, 8)}-${fileNameSlug(ref.name)}`,
              { type: result.content.contentType },
            );
            filesByHash.set(hash, file);
          }
          uploadedFileByUrl.set(ref.contentUrl, file.name);
        } catch {
          // One asset failing must not sink the transcript.
        } finally {
          args.onFetched?.();
        }
      })
    : [];

  await runWithConcurrency(
    [...imageTasks, ...fileTasks],
    ASSET_FETCH_CONCURRENCY,
  );

  return {
    sections: args.sections.map((section) => ({
      ...section,
      messages: section.messages.map((message) =>
        stampMessageFiles(
          stampMessageImages(message, uploadedImageByUrl),
          uploadedFileByUrl,
          tooLargeFileUrls,
        ),
      ),
    })),
    files: [...filesByHash.values()],
  };
}

/**
 * Replaces the n-th `[image]` marker with its uploaded name. The names array
 * is aligned to marker occurrences, exactly as `imageUrls` is.
 */
export function stampImageMarkers(
  text: string,
  names: readonly (string | null)[],
): string {
  let index = 0;
  return text.replaceAll("[image]", (marker) => {
    const name = names[index] ?? null;
    index += 1;
    return name ? `[image: attached as ${name}]` : marker;
  });
}

interface PlannedImage {
  url: string;
  section: TeamsTranscriptSection;
}

function imageFetchPlan(
  sections: readonly TeamsTranscriptSection[],
): PlannedImage[] {
  const seen = new Set<string>();
  const plan: PlannedImage[] = [];
  for (const section of sections) {
    for (const message of section.messages) {
      for (const url of message.imageUrls) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        if (plan.length < MAX_TRANSCRIPT_IMAGES) plan.push({ url, section });
      }
    }
  }
  return plan;
}

function fileFetchPlan(
  sections: readonly TeamsTranscriptSection[],
): TeamsSharedFileRef[] {
  const seen = new Set<string>();
  const plan: TeamsSharedFileRef[] = [];
  for (const section of sections) {
    for (const message of section.messages) {
      for (const ref of message.sharedFiles) {
        if (seen.has(ref.contentUrl)) continue;
        seen.add(ref.contentUrl);
        if (plan.length < MAX_TRANSCRIPT_FILES) plan.push(ref);
      }
    }
  }
  return plan;
}

function stampMessageImages(
  message: ParsedTeamsMessage,
  uploadedByUrl: ReadonlyMap<string, string>,
): ParsedTeamsMessage {
  if (!message.imageUrls.some((url) => url && uploadedByUrl.has(url))) {
    return message;
  }
  const names = message.imageUrls.map((url) =>
    url ? (uploadedByUrl.get(url) ?? null) : null,
  );
  return { ...message, text: stampImageMarkers(message.text, names) };
}

/**
 * Rewrites a file's `[attachment: name]` marker — inline in the body when the
 * message referenced it there, in the appended markers otherwise.
 */
function stampMessageFiles(
  message: ParsedTeamsMessage,
  uploadedByUrl: ReadonlyMap<string, string>,
  tooLargeUrls: ReadonlySet<string>,
): ParsedTeamsMessage {
  const stampFor = (ref: TeamsSharedFileRef): string | null => {
    const uploaded = uploadedByUrl.get(ref.contentUrl);
    if (uploaded) return `[attachment: ${ref.name} — attached as ${uploaded}]`;
    if (tooLargeUrls.has(ref.contentUrl)) {
      return `[attachment: ${ref.name} — too large to attach]`;
    }
    return null;
  };
  if (!message.sharedFiles.some((ref) => stampFor(ref) !== null)) {
    return message;
  }
  let text = message.text;
  const markers = [...message.markers];
  for (const ref of message.sharedFiles) {
    const stamped = stampFor(ref);
    if (!stamped) continue;
    const plain = `[attachment: ${ref.name}]`;
    if (text.includes(plain)) {
      text = text.replace(plain, stamped);
      continue;
    }
    const index = markers.indexOf(plain);
    if (index >= 0) markers[index] = stamped;
    else markers.push(stamped);
  }
  return { ...message, text, markers };
}

/**
 * Dedupe key and filename stem. Not cryptographic on purpose: it only has to
 * tell a handful of assets apart, and unlike `crypto.subtle` it exists in
 * every runtime the add-in and its tests run in.
 */
function fnv1a64Hex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hash = 0xcbf29ce484222325n;
  for (const byte of view) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function imageExtension(contentType: string): string {
  const subtype =
    contentType.split(";")[0]?.split("/")[1]?.trim().toLowerCase() ?? "";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return /^[a-z0-9]+$/.test(subtype) ? subtype : "png";
}

const MAX_FILE_SLUG_LENGTH = 48;

/** Keeps the extension — the backend picks its parser from it. */
function fileNameSlug(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  const clean = (value: string) =>
    value.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  const cleanStem = clean(stem).slice(0, MAX_FILE_SLUG_LENGTH) || "file";
  const cleanExtension = clean(extension);
  return cleanExtension ? `${cleanStem}.${cleanExtension}` : cleanStem;
}
