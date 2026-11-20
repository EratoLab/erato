import {
  findCapabilityByExtension,
  hasSupportedOperations,
} from "@erato/frontend/library";

import { positions } from "./powerpointReads";
import {
  PowerPointTimeoutError,
  powerpointErrorText,
  runPowerPoint,
  withTimeout,
} from "./powerpointRun";

import type { FileCapability } from "@erato/frontend/library";

/** Px; the height follows the slide's aspect ratio. */
export const SLIDE_PICTURE_WIDTH = 960;
/** Per add. Each picture is a file of the message and several hundred tokens for the model. */
export const MAX_SLIDE_PICTURES = 3;
export const SLIDE_PICTURE_TIMEOUT_MS = 20_000;

export interface SlidePicture {
  slideId: string;
  /** 1-based position in the deck, or null when the slide was not in the deck's list. */
  slideNumber: number | null;
  file: File;
}

export type SlidePictureRender =
  | { ok: true; pictures: SlidePicture[]; selectedCount: number }
  | {
      ok: false;
      reason: "nothing-selected" | "timeout" | "failed";
      detail?: string;
    };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngBytes(base64: string): Uint8Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(base64.replace(/^data:[^,]*,/, ""));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return PNG_SIGNATURE.every((byte, i) => bytes[i] === byte) ? bytes : null;
}

function pngFile(base64: string, name: string): File | null {
  const bytes = pngBytes(base64);
  return bytes ? new File([bytes], name, { type: "image/png" }) : null;
}

/** Width and height from the PNG header, or null when the header is not there. */
export function pngSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const ihdr = String.fromCharCode(...bytes.slice(12, 16));
  if (bytes.length < 24 || ihdr !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function slidePictureFileName(slideNumber: number | null): string {
  return slideNumber === null ? "slide.png" : `slide-${slideNumber}.png`;
}

/**
 * The composer's upload rule for a PNG (`validateFiles` in the frontend), applied to the selected
 * model's own capabilities rather than to those of every model the user may pick, plus image
 * understanding: under an upload policy that allows any file, a model without it would still be
 * sent the picture.
 */
export function modelTakesSlidePictures(
  capabilities: readonly FileCapability[] | undefined,
): boolean {
  if (!capabilities?.length) return false;
  const png = findCapabilityByExtension(slidePictureFileName(1), [
    ...capabilities,
  ]);
  if (!png) return false;
  return (
    (png.upload_allowed ?? hasSupportedOperations(png)) &&
    png.operations.includes("analyze_image")
  );
}

/** Renders the first `limit` selected slides, in the order PowerPoint lists the selection. */
export async function renderSelectedSlidePictures({
  limit,
}: {
  limit: number;
}): Promise<SlidePictureRender> {
  const render = runPowerPoint(async (context) => {
    const { presentation } = context;
    const all = presentation.slides.load("items/id");
    const selected = presentation.getSelectedSlides().load("items/id");
    await context.sync();
    const chosen = selected.items.slice(0, Math.max(0, limit));
    const images = chosen.map((slide) =>
      slide.getImageAsBase64({ width: SLIDE_PICTURE_WIDTH }),
    );
    if (chosen.length > 0) await context.sync();
    const order = new Map(all.items.map((slide, i) => [slide.id, i + 1]));
    return {
      selectedCount: selected.items.length,
      rendered: chosen.map((slide, i) => ({
        slideId: slide.id,
        slideNumber: order.get(slide.id) ?? null,
        base64: images[i].value,
      })),
    };
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  // A render that times out still holds runPowerPoint's queue until PowerPoint answers.
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SLIDE_PICTURE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([render, timeout]);
    if (result === "timeout") return { ok: false, reason: "timeout" };
    if (result.selectedCount === 0)
      return { ok: false, reason: "nothing-selected" };
    const pictures: SlidePicture[] = [];
    for (const { slideId, slideNumber, base64 } of result.rendered) {
      const file = pngFile(base64, slidePictureFileName(slideNumber));
      if (!file)
        return {
          ok: false,
          reason: "failed",
          detail: `slide ${slideId}: not a PNG`,
        };
      pictures.push({ slideId, slideNumber, file });
    }
    return { ok: true, pictures, selectedCount: result.selectedCount };
  } catch (error) {
    return { ok: false, reason: "failed", detail: powerpointErrorText(error) };
  } finally {
    clearTimeout(timer);
  }
}

export type SlidePictureById =
  | {
      ok: true;
      slideId: string;
      /** 1-based position in the deck. */
      position: number;
      slideCount: number;
      file: File;
      size: { width: number; height: number } | null;
    }
  | {
      ok: false;
      reason: "not-found" | "timeout" | "failed" | "stopped";
      detail?: string;
    };

/**
 * Renders one slide by id, whether or not it is selected. The add-in API has no hidden flag, so a
 * hidden slide is rendered like any other. The limit counts the wait behind other PowerPoint calls
 * too; a batch that has not started by then never starts, and one that hangs frees the queue.
 */
export async function renderSlidePicture(
  slideId: string,
  signal?: AbortSignal,
): Promise<SlidePictureById> {
  let gaveUp = false;
  const work = runPowerPoint(async (context) => {
    if (gaveUp || signal?.aborted) return "stopped" as const;
    const all = context.presentation.slides.load("items/id");
    const slide = context.presentation.slides
      .getItemOrNullObject(slideId)
      .load("id");
    await context.sync();
    if (slide.isNullObject) return null;
    const image = slide.getImageAsBase64({ width: SLIDE_PICTURE_WIDTH });
    await context.sync();
    return {
      slideId: slide.id,
      position: positions(all).get(slide.id) ?? 0,
      slideCount: all.items.length,
      base64: image.value,
    };
  }, SLIDE_PICTURE_TIMEOUT_MS);
  try {
    const rendered = await withTimeout(
      work,
      SLIDE_PICTURE_TIMEOUT_MS,
      "PowerPoint",
    );
    if (rendered === "stopped") return { ok: false, reason: "stopped" };
    if (!rendered) return { ok: false, reason: "not-found" };
    const bytes = pngBytes(rendered.base64);
    if (!bytes) return { ok: false, reason: "failed", detail: "not a PNG" };
    return {
      ok: true,
      slideId: rendered.slideId,
      position: rendered.position,
      slideCount: rendered.slideCount,
      file: new File([bytes], slidePictureFileName(rendered.position || null), {
        type: "image/png",
      }),
      size: pngSize(bytes),
    };
  } catch (error) {
    if (error instanceof PowerPointTimeoutError) {
      gaveUp = true;
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "failed", detail: powerpointErrorText(error) };
  }
}
