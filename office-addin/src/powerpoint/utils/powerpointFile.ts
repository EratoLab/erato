import {
  PowerPointTimeoutError,
  powerpointErrorText,
  runPowerPoint,
  withTimeout,
} from "./powerpointRun";
import {
  OfficeZipTooLargeError,
  bytesSource,
  openOfficeZip,
} from "../../utils/officeZipReader";

import type { OfficeZip, ZipByteSource } from "../../utils/officeZipReader";

/**
 * Both routes stay well inside the 30 s a tool call gets, so a slow file still leaves time to
 * return the live read. PowerPoint for the web is reported to take 10–40 s for the whole file
 * (office-js #3443); there the slide export is the route, and the whole file only its fallback.
 */
export const POWERPOINT_FILE_LIMITS = {
  exportTimeoutMs: 12_000,
  exportMaxBytes: 48 * 1024 * 1024,
  fileBudgetMs: 12_000,
  fileMaxBytes: 512 * 1024 * 1024,
  sliceBytes: 4 * 1024 * 1024,
  closeTimeoutMs: 2_000,
};

export type PowerPointFileFailure =
  | "timeout"
  | "too-large"
  | "refused"
  | "failed";

export class PowerPointFileError extends Error {
  constructor(
    readonly kind: PowerPointFileFailure,
    message: string,
  ) {
    super(message);
    this.name = "PowerPointFileError";
  }
}

/** Why a file read failed, worded for the model's `unread` notes. */
export function powerpointFileFailure(error: unknown): string {
  if (error instanceof PowerPointFileError) return error.message;
  if (error instanceof PowerPointTimeoutError)
    return "PowerPoint did not hand over the presentation file in time";
  if (error instanceof OfficeZipTooLargeError)
    return "the presentation file is too large to read here";
  return `the presentation file could not be read (${powerpointErrorText(error)})`;
}

let fileQueue: Promise<unknown> = Promise.resolve();

/** One file read at a time: Office keeps at most two files open per document. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(work);
  fileQueue = run.catch(() => undefined);
  return run;
}

function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The one-slide presentation `slide.exportAsBase64()` returns (PowerPointApi 1.8). */
export function withExportedSlide<T>(
  slideId: string,
  use: (zip: OfficeZip) => Promise<T>,
): Promise<T> {
  return serial(async () => {
    const base64 = await runPowerPoint(async (context) => {
      const exported = context.presentation.slides
        .getItem(slideId)
        .exportAsBase64();
      await context.sync();
      return exported.value;
    }, POWERPOINT_FILE_LIMITS.exportTimeoutMs);
    if (typeof base64 !== "string" || base64.length === 0)
      throw new PowerPointFileError(
        "failed",
        "PowerPoint returned an empty slide export",
      );
    if (base64.length * 0.75 > POWERPOINT_FILE_LIMITS.exportMaxBytes)
      throw new PowerPointFileError(
        "too-large",
        "the slide is too large to read from its file (pictures or media over 48 MB)",
      );
    return use(await openOfficeZip(bytesSource(base64Bytes(base64))));
  });
}

const OFFICE_FILE_LIMIT_REACHED = 11000;

/**
 * The saved form of the open presentation through `getFileAsync`, the one file route on every host.
 * Only the slices the reader asks for are fetched, so a deck full of pictures costs the directory
 * and the parts of one slide, not its media. The handle is closed before this returns.
 */
export function withPresentationFile<T>(
  use: (zip: OfficeZip) => Promise<T>,
): Promise<T> {
  return serial(async () => {
    const document = globalThis.Office?.context?.document;
    if (typeof document?.getFileAsync !== "function")
      throw new PowerPointFileError(
        "refused",
        "this PowerPoint does not hand over the presentation file",
      );
    const deadline = Date.now() + POWERPOINT_FILE_LIMITS.fileBudgetMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    const file = await openFile(document, remaining());
    try {
      const source = slicedSource(file, remaining);
      return await withTimeout(
        openOfficeZip(source).then(use),
        remaining(),
        "The presentation file",
      );
    } finally {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(
          resolve,
          POWERPOINT_FILE_LIMITS.closeTimeoutMs,
        );
        file.closeAsync(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });
}

function openFile(document: Office.Document, ms: number): Promise<Office.File> {
  return new Promise<Office.File>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new PowerPointTimeoutError("The presentation file"));
    }, ms);
    document.getFileAsync(
      Office.FileType.Compressed,
      { sliceSize: POWERPOINT_FILE_LIMITS.sliceBytes },
      (result) => {
        clearTimeout(timer);
        const succeeded = result.status === Office.AsyncResultStatus.Succeeded;
        // A handle that arrives after the timeout would otherwise hold one of Office's two slots.
        if (timedOut) {
          if (succeeded) result.value.closeAsync(() => {});
          return;
        }
        if (succeeded) resolve(result.value);
        else
          reject(
            new PowerPointFileError(
              "refused",
              result.error?.code === OFFICE_FILE_LIMIT_REACHED
                ? "PowerPoint has too many copies of the file open; try again in a moment"
                : `PowerPoint refused to hand over the presentation file${result.error?.message ? ` (${result.error.message})` : ""}`,
            ),
          );
      },
    );
  });
}

function slicedSource(
  file: Office.File,
  remaining: () => number,
): ZipByteSource {
  const { size, sliceCount } = file;
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !Number.isSafeInteger(sliceCount) ||
    sliceCount <= 0
  )
    throw new PowerPointFileError(
      "failed",
      "PowerPoint returned an incomplete presentation file",
    );
  if (size > POWERPOINT_FILE_LIMITS.fileMaxBytes)
    throw new PowerPointFileError(
      "too-large",
      `the presentation file is ${Math.round(size / 1024 / 1024)} MB; files up to ${POWERPOINT_FILE_LIMITS.fileMaxBytes / 1024 / 1024} MB are read`,
    );
  const sliceBytes =
    sliceCount === 1 ? size : POWERPOINT_FILE_LIMITS.sliceBytes;
  if (Math.ceil(size / sliceBytes) !== sliceCount)
    throw new PowerPointFileError(
      "failed",
      "PowerPoint sliced the presentation file in an unexpected way",
    );
  const slices = new Map<number, Promise<Uint8Array>>();
  const slice = (index: number) => {
    let pending = slices.get(index);
    if (!pending) {
      const expected = Math.min(sliceBytes, size - index * sliceBytes);
      pending = withTimeout(
        new Promise<Uint8Array>((resolve, reject) =>
          file.getSliceAsync(index, (result) => {
            if (result.status !== Office.AsyncResultStatus.Succeeded) {
              reject(
                new PowerPointFileError(
                  "failed",
                  "PowerPoint could not read part of the presentation file",
                ),
              );
              return;
            }
            const data = new Uint8Array(result.value.data as ArrayLike<number>);
            if (result.value.index !== index || data.length !== expected)
              reject(
                new PowerPointFileError(
                  "failed",
                  "PowerPoint returned an incomplete presentation file",
                ),
              );
            else resolve(data);
          }),
        ),
        remaining(),
        "The presentation file",
      );
      slices.set(index, pending);
    }
    return pending;
  };
  return {
    size,
    async read(offset, length) {
      const end = Math.min(size, offset + length);
      const out = new Uint8Array(Math.max(0, end - offset));
      for (
        let index = Math.floor(offset / sliceBytes);
        index * sliceBytes < end;
        index++
      ) {
        const data = await slice(index);
        const start = index * sliceBytes;
        const from = Math.max(offset, start);
        const to = Math.min(end, start + data.length);
        out.set(data.subarray(from - start, to - start), from - offset);
      }
      return out;
    },
  };
}
