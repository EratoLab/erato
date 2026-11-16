import type { V1betaApiContext } from "./v1betaApiContext";
import { tryRecoverAuth } from "../../../auth/authRecovery";
import { mergeApiAuthHeaders } from "../../../auth/apiRequestAuth";
import {
  connectivity,
  isNetworkFailure,
  markNetworkFailure,
} from "../../connectivity/connectivity";

const baseUrl = ""; // TODO add your baseUrl

/**
 * How long a read may wait for the response to start. Reads only: a write may
 * still be running on the server, so cutting it off and retrying could apply
 * it twice. Without a limit, a request on a connection that died silently can
 * hang for minutes. The body is not limited, so a slow download completes.
 */
export const READ_RESPONSE_TIMEOUT_MS = 45_000;

function withReadTimeout(method: string, callerSignal?: AbortSignal) {
  if (method.toUpperCase() !== "GET") {
    return {
      signal: callerSignal,
      timedOut: () => false,
      responded: () => {},
      clear: () => {},
    };
  }
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    forwardAbort();
  } else {
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, READ_RESPONSE_TIMEOUT_MS);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    responded: () => clearTimeout(timer),
    clear: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

export type ErrorWrapper<TError> =
  | TError
  | { status: "unknown"; payload: string }
  | { status: number; payload: string };

export type V1betaApiFetcherOptions<
  TBody,
  THeaders,
  TQueryParams,
  TPathParams,
> = {
  url: string;
  method: string;
  body?: TBody;
  headers?: THeaders;
  queryParams?: TQueryParams;
  pathParams?: TPathParams;
  signal?: AbortSignal;
} & V1betaApiContext["fetcherOptions"];

export async function v1betaApiFetch<
  TData,
  TError,
  TBody extends {} | FormData | undefined | null,
  THeaders extends {},
  TQueryParams extends {},
  TPathParams extends {},
>(
  options: V1betaApiFetcherOptions<TBody, THeaders, TQueryParams, TPathParams>,
  // Add-in only: allow a single auth-recovery retry on 401. The recursive
  // replay below sets this false so it can't loop. No-op for the web app, which
  // registers no recovery handler (see ../../../auth/authRecovery).
  allowAuthRetry = true,
): Promise<TData> {
  const { url, method, body, headers, pathParams, queryParams, signal } =
    options;
  let error: ErrorWrapper<TError>;
  const readTimeout = withReadTimeout(method, signal);
  // Separates fetch's own "no response" TypeError from TypeErrors thrown while
  // building the request, such as a body JSON.stringify cannot serialize.
  let requestSent = false;
  try {
    const isFormDataBody = body instanceof FormData;
    const requestHeaders = mergeApiAuthHeaders({
      ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(headers as Record<string, string | undefined> | undefined),
    });

    /**
     * As the fetch API is being used, when multipart/form-data is specified
     * the Content-Type header must be deleted so that the browser can set
     * the correct boundary.
     * https://developer.mozilla.org/en-US/docs/Web/API/FormData/Using_FormData_Objects#sending_files_using_a_formdata_object
     */
    if (
      isFormDataBody ||
      requestHeaders["Content-Type"]?.toLowerCase().includes("multipart/form-data")
    ) {
      delete requestHeaders["Content-Type"];
    }

    const requestUrl = `${baseUrl}${resolveUrl(url, queryParams, pathParams)}`;
    const requestInit: RequestInit = {
      signal: readTimeout.signal,
      method: method.toUpperCase(),
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
      headers: requestHeaders,
    };
    requestSent = true;
    const response = await window.fetch(requestUrl, requestInit);
    readTimeout.responded();
    connectivity.reportNetworkSuccess();
    if (!response.ok) {
      // On a 401, ask the (optionally) registered recovery handler to refresh
      // the session, then replay the request exactly once. Falls straight
      // through for the web app (tryRecoverAuth returns false with no handler).
      if (
        response.status === 401 &&
        allowAuthRetry &&
        (await tryRecoverAuth("rest-401"))
      ) {
        return v1betaApiFetch<
          TData,
          TError,
          TBody,
          THeaders,
          TQueryParams,
          TPathParams
        >(options, false);
      }
      try {
        error = await response.json();
      } catch (e) {
        // Always preserve the HTTP status code, even if we can't parse the response
        error = {
          status: response.status,
          payload:
              e instanceof Error
                  ? `Unexpected error (${e.message})`
                  : "Unexpected error",
        };
      }
    } else if (response.headers.get("content-type")?.includes("json")) {
      return await response.json();
    } else {
      // if it is not a json response, assume it is a blob and cast it to TData
      return (await response.blob()) as unknown as TData;
    }
  } catch (e) {
    if (isNetworkFailure(e)) {
      throw e;
    }
    const errorObject: Error = {
      name: "unknown" as const,
      message: readTimeout.timedOut()
        ? "Network error (request timed out)"
        : e instanceof Error
          ? `Network error (${e.message})`
          : "Network error",
      stack: e as string,
    };
    // fetch rejects with a TypeError when no response arrives, and reading the
    // body does the same when the connection drops mid-body. Anything else
    // caught here, such as the replay's HTTP error or a JSON SyntaxError, is not
    // a connection problem.
    const noResponse =
      readTimeout.timedOut() || (requestSent && e instanceof TypeError);
    if (noResponse && signal?.aborted !== true) {
      markNetworkFailure(errorObject);
      connectivity.reportNetworkFailure();
    }
    throw errorObject;
  } finally {
    readTimeout.clear();
  }
  throw error;
}

const resolveUrl = (
  url: string,
  queryParams: Record<string, unknown> = {},
  pathParams: Record<string, string> = {},
) => {
  let query = new URLSearchParams(
    Object.entries(queryParams)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  if (query) query = `?${query}`;
  return (
    url.replace(/\{\w*\}/g, (key) => pathParams[key.slice(1, -1)] ?? "") + query
  );
};
