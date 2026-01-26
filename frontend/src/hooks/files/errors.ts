import { i18n } from "@lingui/core";

import type { UploadFileError as ApiUploadFileError } from "@/lib/generated/v1betaApi/v1betaApiComponents";

export class UploadTooLargeError extends Error {
  constructor(maxSizeFormatted?: string) {
    // Use the runtime API with string ID for i18n
    // The message catalog is populated by lingui extract from other source files
    // When maxSizeFormatted is not provided, use a fallback indicator
    const message = i18n._("upload.error.tooLarge", {
      maxSize: maxSizeFormatted ?? "—",
    });

    super(message);
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadTooLargeError";
  }
}

export class UploadUnknownError extends Error {
  constructor(message?: string) {
    const baseMessage = i18n._("upload.error.unknown");
    super(message ? `${baseMessage}: ${message}` : baseMessage);
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "UploadUnknownError";
  }
}

export class CloudLinkError extends Error {
  constructor() {
    super(i18n._("upload.error.cloudLink"));
    // eslint-disable-next-line lingui/no-unlocalized-strings
    this.name = "CloudLinkError";
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

  // Case 2: Firefox-specific fallback for opaque NetworkError
  const isFirefox =
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("firefox");
  if (
    isFirefox &&
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any,lingui/no-unlocalized-strings
    (error.message as any).includes("NetworkError") // More robust check
  ) {
    console.warn(
      "A generic NetworkError was caught in a Firefox environment. This is likely due to the file size exceeding browser or server limits. Treating as UploadTooLargeError.",
    );
    return true;
  }

  return false;
}

export type UploadError =
  | UploadTooLargeError
  | UploadUnknownError
  | CloudLinkError;
