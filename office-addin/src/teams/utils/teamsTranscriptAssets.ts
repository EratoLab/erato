/**
 * Turns the images pasted into selected Teams messages into upload files and
 * stamps each message's `[image]` marker with the uploaded name, which is how
 * the model joins file ↔ message: the backend keys parsed uploads by filename
 * and the marker sits at the exact message position.
 *
 * Everything degrades to the bare marker: a failed fetch, an oversized image
 * or the cap leaves `[image]` exactly as it reads today.
 */

import { runWithConcurrency } from "../../utils/graph/graphClient";

import type { TeamsTranscriptSection } from "./buildTeamsTranscriptFile";
import type { ParsedTeamsMessage } from "./parsedTeamsChat";
import type { TeamsHostedContent } from "./teamsChatGraph";

/** Vision input is expensive; a transcript is an excerpt, not an album. */
export const MAX_TRANSCRIPT_IMAGES = 10;
/** Pasted screenshots are small; anything bigger is not worth the tokens. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Same-conversation fetches serialize on the gate anyway. */
const IMAGE_FETCH_CONCURRENCY = 3;

export type FetchTeamsImage = (
  section: TeamsTranscriptSection,
  url: string,
) => Promise<TeamsHostedContent | null>;

export interface TeamsImageAssetsResult {
  /** The input sections with fetched images stamped into their markers. */
  sections: TeamsTranscriptSection[];
  files: File[];
}

/** Fetches the plan will attempt — the progress denominator. */
export function planTeamsImageFetches(
  sections: readonly TeamsTranscriptSection[],
): number {
  return imageFetchPlan(sections).length;
}

export async function collectTeamsImageAssets(args: {
  sections: readonly TeamsTranscriptSection[];
  fetchImage: FetchTeamsImage;
  /** Called exactly once per planned fetch, success or not. */
  onFetched?: () => void;
  signal?: AbortSignal;
}): Promise<TeamsImageAssetsResult> {
  const plan = imageFetchPlan(args.sections);
  const uploadedByUrl = new Map<string, string>();
  const filesByHash = new Map<string, File>();

  const tasks = plan.map((planned) => async () => {
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
      uploadedByUrl.set(planned.url, file.name);
    } catch {
      // One image failing must not sink the transcript.
    } finally {
      args.onFetched?.();
    }
  });
  await runWithConcurrency(tasks, IMAGE_FETCH_CONCURRENCY);

  return {
    sections: args.sections.map((section) => ({
      ...section,
      messages: section.messages.map((message) =>
        stampMessageImages(message, uploadedByUrl),
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
 * Dedupe key and filename stem. Not cryptographic on purpose: it only has to
 * tell ≤{@link MAX_TRANSCRIPT_IMAGES} images apart, and unlike `crypto.subtle`
 * it exists in every runtime the add-in and its tests run in.
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
