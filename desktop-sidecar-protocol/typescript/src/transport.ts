import { SidecarClientError } from "./errors.js";

export const MAX_BODY_BYTES = 262_144;

export interface SidecarTransportRequestOptions {
  signal?: AbortSignal;
}

export interface SidecarTransport {
  request(
    body: string,
    options?: SidecarTransportRequestOptions,
  ): Promise<string>;
  /**
   * Fetch the bytes referenced by a transfer handle from the binary transfer
   * profile. Unbounded — the JSON-RPC body cap does not apply.
   */
  transfer(
    handle: string,
    options?: SidecarTransportRequestOptions,
  ): Promise<Uint8Array>;
}

export type SidecarFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpTransportOptions {
  fetch?: SidecarFetch;
  maxBodyBytes?: number;
}

export class HttpTransport implements SidecarTransport {
  readonly #url: string;
  readonly #fetch: SidecarFetch;
  readonly #maxBodyBytes: number;

  constructor(url: string, options: HttpTransportOptions = {}) {
    this.#url = url;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  }

  async request(
    body: string,
    options: SidecarTransportRequestOptions = {},
  ): Promise<string> {
    this.#assertBodySize(body, "Request");

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
      Number(contentLength) > this.#maxBodyBytes
    ) {
      throw new SidecarClientError(
        "malformed_message",
        `Response body exceeds ${this.#maxBodyBytes} bytes.`,
      );
    }

    const responseBody = await response.text();
    this.#assertBodySize(responseBody, "Response");
    return responseBody;
  }

  async transfer(
    handle: string,
    options: SidecarTransportRequestOptions = {},
  ): Promise<Uint8Array> {
    // The transfer path shares the RPC endpoint's directory, so resolve it
    // relative to the configured URL to preserve any deployment prefix.
    const url = new URL(`transfer/v1/${encodeURIComponent(handle)}`, this.#url);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { Accept: "application/octet-stream" },
        cache: "no-store",
        credentials: "omit",
        signal: options.signal,
      });
    } catch (cause) {
      throw new SidecarClientError(
        "transport_error",
        "The sidecar transfer request failed.",
        { cause },
      );
    }

    if (response.status === 404) {
      throw new SidecarClientError(
        "transport_error",
        "The transfer handle is unknown or has expired.",
      );
    }
    if (response.status !== 200) {
      throw new SidecarClientError(
        "transport_error",
        `The sidecar transfer returned HTTP ${response.status}.`,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  #assertBodySize(body: string, label: string): void {
    if (new TextEncoder().encode(body).byteLength > this.#maxBodyBytes) {
      throw new SidecarClientError(
        "malformed_message",
        `${label} body exceeds ${this.#maxBodyBytes} bytes.`,
      );
    }
  }
}
