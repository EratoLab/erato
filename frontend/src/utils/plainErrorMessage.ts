import { t } from "@lingui/core/macro";

import { isChunkLoadError } from "@/lib/chunkLoadRecovery";
import {
  isNetworkFailure,
  isStalledStream,
} from "@/lib/connectivity/connectivity";

import { FrontendRequestError } from "./errorReport";

// The browsers' own words for a request that got no answer (Safari, Chrome,
// Firefox, older WebKit), bare or wrapped by the request layer as
// "Network error (…)".
const BROWSER_NO_ANSWER =
  /(?:Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|Network request failed|The network connection was lost\.?|The Internet connection appears to be offline\.?)/
    .source;
const NO_CONNECTION_RE = new RegExp(
  `^(?:${BROWSER_NO_ANSWER}|Network error(?: \\(${BROWSER_NO_ANSWER}\\))?)$`,
);
const TIMED_OUT_MESSAGE = "Network error (request timed out)";
const STALLED_RE = /^SSE stream stalled$/;
const CLOSED_RE = /^SSE connection closed unexpectedly/;
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_RE = /^SSE request failed: (502|503|504)\b/;

function messageOf(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string") return message;
  }
  return null;
}

function statusOf(error: unknown): number | null {
  if (error instanceof FrontendRequestError) {
    return error.response?.status ?? null;
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error;
    if (typeof status === "number") return status;
  }
  return null;
}

/** "No connection" in plain words, for callers that know the network is down. */
export function noConnectionMessage(): string {
  return t({
    id: "error.plain.noConnection",
    message: "No connection to the server. Check your network and try again.",
  });
}

/**
 * Plain words for the technical errors people otherwise see as they are
 * ("Load failed", "SSE stream stalled", "[object Object]"). Any other error
 * keeps its own message, so detail the server sent is not swallowed. Returns
 * null when the error has nothing to show, so the caller picks its own text.
 */
export function plainErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const message = messageOf(error)?.trim() ?? "";

  if (isChunkLoadError(error)) {
    return t({
      id: "error.plain.appUpdated",
      message:
        "Part of the app could not be loaded. Reload the page to continue.",
    });
  }

  if (isStalledStream(error) || STALLED_RE.test(message)) {
    return t({
      id: "error.plain.serverStoppedAnswering",
      message: "The server stopped answering. Please try again.",
    });
  }
  if (message === TIMED_OUT_MESSAGE) {
    return t({
      id: "error.plain.timedOut",
      message: "The server did not answer in time. Please try again.",
    });
  }
  if (isNetworkFailure(error) || NO_CONNECTION_RE.test(message)) {
    return noConnectionMessage();
  }
  if (CLOSED_RE.test(message)) {
    return t({
      id: "error.plain.connectionLost",
      message: "The connection to the server was lost. Please try again.",
    });
  }
  const status = statusOf(error);
  if (
    (status !== null && GATEWAY_STATUSES.has(status)) ||
    GATEWAY_RE.test(message)
  ) {
    return t({
      id: "error.plain.serverDidNotAnswer",
      message: "The server did not answer. Please try again in a moment.",
    });
  }

  if (!message || message === "[object Object]") return null;
  return message;
}
