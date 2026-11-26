import { i18n } from "@lingui/core";

import {
  connectivity,
  isNetworkFailure,
} from "@/lib/connectivity/connectivity";
import {
  knownErrorMessage,
  noConnectionMessage,
} from "@/utils/plainErrorMessage";

import type { UploadFileError as ApiUploadFileError } from "@/lib/generated/v1betaApi/v1betaApiComponents";

export class UploadTooLargeError extends Error {
  /** Names of the files that exceeded the limit, when the caller knew them. */
  public readonly filenames: string[];

  constructor(maxSizeFormatted?: string, filenames: string | string[] = []) {
    const filenameArray = Array.isArray(filenames) ? filenames : [filenames];
    // Explicit-ID `i18n._` calls are the extraction anchor; no macro needed.
    const maxSize = maxSizeFormatted ?? "—";
    // `count` drives an ICU plural so pl can inflect beyond one/other.
    const message =
      filenameArray.length > 0
        ? i18n._("upload.error.tooLargeNamed", {
            maxSize,
            count: filenameArray.length,
            filenames: filenameArray.join(", "),
          })
        : i18n._("upload.error.tooLarge", { maxSize });

    super(message);
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadTooLargeError";
    this.filenames = filenameArray;
  }
}

export class UploadUnknownError extends Error {
  /**
   * `detail` is the caller's own text, or anything a request threw: a known
   * failure is said in plain words alone; a thrown value without readable
   * text stays in the logs and the copied error report.
   */
  constructor(detail?: unknown) {
    const baseMessage = i18n._("upload.error.unknown");
    const known = knownErrorMessage(detail);
    const text =
      typeof detail === "string"
        ? detail
        : detail instanceof Error
          ? detail.message
          : "";
    super(known ?? (text ? `${baseMessage}: ${text}` : baseMessage));
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadUnknownError";
  }
}

/** The upload got no answer, also after waiting for the network and trying again. */
export class UploadNetworkError extends Error {
  constructor(cause: unknown) {
    super(knownErrorMessage(cause) ?? noConnectionMessage(), { cause });
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadNetworkError";
  }
}

export class CloudLinkError extends Error {
  constructor() {
    super(i18n._("upload.error.cloudLink"));
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "CloudLinkError";
  }
}

/** A file shared from another app that arrived without content this page can read. */
export class SharedFileWithoutContentError extends Error {
  public readonly filenames: string[];

  constructor(filenames: string[]) {
    super(
      i18n._("upload.error.sharedWithoutContent", {
        count: filenames.length,
        filenames: filenames.join(", "),
      }),
    );
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "SharedFileWithoutContentError";
    this.filenames = filenames;
  }
}

/** Several reports about one set of files, shown together in the one error slot. */
export class CombinedUploadError extends Error {
  constructor(errors: Error[]) {
    super(errors.map((error) => error.message).join(" "));
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "CombinedUploadError";
  }
}

/**
 * Error for unsupported file types (no operations available)
 */
export class UnsupportedFileTypeError extends Error {
  public readonly filenames: string[];

  constructor(filenames: string | string[]) {
    const filenameArray = Array.isArray(filenames) ? filenames : [filenames];
    const message = i18n._("upload.error.unsupportedFileType", {
      filenames: filenameArray.join(", "),
    });
    super(message);
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UnsupportedFileTypeError";
    this.filenames = filenameArray;
  }
}

/**
 * Checks if an error indicates a file upload was too large.
 *
 * This function handles two cases:
 * 1. A standard API error with status 413. This can be from the generated client
 *    which might have a numeric status, or a custom error with a string status.
 * 2. A Firefox-specific `TypeError` with the message "NetworkError when attempting
 *    to fetch resource." This occurs when Firefox's networking stack stops a
 *    request before it is sent, often due to size limits, resulting in an
 *    opaque error.
 *
 * @param error The error object to inspect.
 * @returns `true` if the error signifies a "too large" condition, otherwise `false`.
 */
export function isUploadTooLarge(error: unknown): error is ApiUploadFileError {
  // Case 1: Check for a status property (numeric or string) equal to 413
  // Note: The API fetcher returns status as a number (response.status), but we also
  // check for string "413" for backwards compatibility
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((error as any).status === 413 || (error as any).status === "413")
  ) {
    return true;
  }

  // Case 2: Firefox-specific fallback for opaque NetworkError. A real network
  // drop gives the same text, so only while the server is reachable.
  if (connectivity.getStatus() !== "online") return false;
  const isFirefox =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("firefox");
  if (
    isFirefox &&
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,lingui/no-unlocalized-strings
    (error.message as any).includes("NetworkError")
  ) {
    console.warn(
      "A generic NetworkError was caught in a Firefox environment. This is likely due to the file size exceeding browser or server limits. Treating as UploadTooLargeError.",
    );
    return true;
  }

  return false;
}

/**
 * Checks if an error is an unsupported file type error
 */
export function isUnsupportedFileType(
  error: unknown,
): error is UnsupportedFileTypeError {
  return error instanceof UnsupportedFileTypeError;
}

/** Turns what an upload request threw into the error the composer shows. */
export function toUploadError(
  error: unknown,
  filenames: string[],
  maxSizeFormatted?: string,
): UploadTooLargeError | UploadNetworkError | UploadUnknownError {
  if (isUploadTooLarge(error)) {
    return new UploadTooLargeError(maxSizeFormatted, filenames);
  }
  if (isNetworkFailure(error)) return new UploadNetworkError(error);
  return new UploadUnknownError(error);
}

export type UploadError =
  | UploadTooLargeError
  | UploadUnknownError
  | UploadNetworkError
  | CloudLinkError
  | UnsupportedFileTypeError
  | SharedFileWithoutContentError
  | CombinedUploadError;
