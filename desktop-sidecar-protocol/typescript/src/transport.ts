import { SidecarClientError } from "./errors.js";

export const MAX_BODY_BYTES = 262_144;
export const MAX_RESPONSE_BYTES = 67_108_864;

export interface SidecarTransportRequestOptions {
  signal?: AbortSignal;
}

export interface SidecarTransport {
  request(
    body: string,
    options?: SidecarTransportRequestOptions,
  ): Promise<string>;
}

export type SidecarFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpTransportOptions {
  fetch?: SidecarFetch;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
}

export class HttpTransport implements SidecarTransport {
  readonly #url: string;
  readonly #fetch: SidecarFetch;
  readonly #maxBodyBytes: number;
  readonly #maxResponseBytes: number;

  constructor(url: string, options: HttpTransportOptions = {}) {
    this.#url = url;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  }

  async request(
    body: string,
    options: SidecarTransportRequestOptions = {},
  ): Promise<string> {
    this.#assertBodySize(body, this.#maxBodyBytes, "Request");

    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body,
        cache: "no-store",
        credentials: "omit",
        signal: options.signal,
      });
    } catch (cause) {
      throw new SidecarClientError(
        "transport_error",
        "The sidecar HTTP request failed.",
        { cause },
      );
    }

    if (response.status !== 200) {
      throw new SidecarClientError(
        "transport_error",
        `The sidecar returned HTTP ${response.status}.`,
      );
    }

    const contentType = response.headers.get("Content-Type");
    if (
      contentType?.split(";", 1)[0].trim().toLowerCase() !== "application/json"
    ) {
      throw new SidecarClientError(
        "malformed_message",
        "The sidecar response is not application/json.",
      );
    }

    const contentLength = response.headers.get("Content-Length");
    if (
      contentLength !== null &&
      Number.isFinite(Number(contentLength)) &&
      Number(contentLength) > this.#maxResponseBytes
    ) {
      throw new SidecarClientError(
        "malformed_message",
        `Response body exceeds ${this.#maxResponseBytes} bytes.`,
      );
    }

    const responseBody = await response.text();
    this.#assertBodySize(responseBody, this.#maxResponseBytes, "Response");
    return responseBody;
  }

  #assertBodySize(body: string, limit: number, label: string): void {
    if (new TextEncoder().encode(body).byteLength > limit) {
      throw new SidecarClientError(
        "malformed_message",
        `${label} body exceeds ${limit} bytes.`,
      );
    }
  }
}
