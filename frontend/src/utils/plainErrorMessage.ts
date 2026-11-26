import { t } from "@lingui/core/macro";

import { isChunkLoadError } from "@/lib/chunkLoadRecovery";
import {
  isNetworkFailure,
  isStalledStream,
} from "@/lib/connectivity/connectivity";
import { REQUEST_TIMED_OUT_MESSAGE } from "@/lib/generated/v1betaApi/v1betaApiFetcher";

import { FrontendRequestError } from "./errorReport";

// The browsers' own words for a request that got no answer (Safari, Chrome,
// Firefox, older WebKit), bare or wrapped as "Network error (…)". Fetches
// outside the request layer arrive without the network-failure tag.
const BROWSER_NO_ANSWER =
  /(?:Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|Network request failed|The network connection was lost\.?|The Internet connection appears to be offline\.?)/
    .source;
const NO_CONNECTION_RE = new RegExp(
  `^(?:${BROWSER_NO_ANSWER}|Network error(?: \\(${BROWSER_NO_ANSWER}\\))?)$`,
);
// Set as plain `Error`s by the chat when a stream ends without its last event.
const CLOSED_RE = /^SSE connection closed unexpectedly/;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

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
 * ("Load failed", "SSE stream stalled", a gateway's 502), or null for any
 * other error.
 */
export function knownErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const message = messageOf(error)?.trim() ?? "";

  if (isChunkLoadError(error)) {
    return t({
      id: "error.plain.appUpdated",
      message: "Part of the app could not be loaded. Reload to continue.",
    });
  }
  if (isStalledStream(error)) {
    return t({
      id: "error.plain.serverStoppedAnswering",
      message: "The server stopped answering. Please try again.",
    });
  }
  if (message === REQUEST_TIMED_OUT_MESSAGE) {
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
  if (status !== null && GATEWAY_STATUSES.has(status)) {
    return t({
      id: "error.plain.serverDidNotAnswer",
      message: "The server did not answer. Please try again in a moment.",
    });
  }
  return null;
}

/**
 * `knownErrorMessage`, else the error's own message, so detail the server
 * sent is not swallowed. Null when the error has nothing readable to show (a
 * plain object gives no "[object Object]"), so the caller picks its own text.
 */
export function plainErrorMessage(error: unknown): string | null {
  const known = knownErrorMessage(error);
  if (known) return known;
  const message = messageOf(error)?.trim();
  if (!message || message === "[object Object]") return null;
  return message;
}
