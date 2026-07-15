import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { EmlPreview } from "./EmlPreview";

import type React from "react";

const renderEml = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const FILE = {
  filename: "message.eml",
  url: "https://files.example.com/message.eml",
};

const stringToBuffer = (s: string): ArrayBuffer => {
  const encoded = new TextEncoder().encode(s);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
};

const mockFetchEml = (bytes: ArrayBuffer | string) => {
  const buffer = typeof bytes === "string" ? stringToBuffer(bytes) : bytes;
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("blob:")) {
      const blob = blobUrlContent.get(url);
      if (!blob) throw new Error(`unmapped blob URL: ${url}`);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => blob.arrayBuffer(),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer,
    } as Response;
  });
};

let blobUrlCounter = 0;
const createdBlobUrls: string[] = [];
// Keyed by mocked blob URL; lets `mockFetchEml` route `fetch(blobUrl)`
// requests (e.g. from `EmlThreadBody`'s nested-message parsing) back to
// the original Blob bytes that `URL.createObjectURL` was called with.
const blobUrlContent = new Map<string, Blob>();

beforeEach(() => {
  blobUrlCounter = 0;
  createdBlobUrls.length = 0;
  blobUrlContent.clear();
  if (typeof window.localStorage.getItem !== "function") {
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
        get length() {
          return store.size;
        },
        key: (i: number) => Array.from(store.keys())[i] ?? null,
      },
    });
  }
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (blob: Blob) => {
      const url = `blob:mock/${++blobUrlCounter}`;
      createdBlobUrls.push(url);
      blobUrlContent.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const HTML_EML = [
  "From: Alice <alice@example.com>",
  "To: Bob <bob@example.com>",
  "Cc: Carol <carol@example.com>",
  "Subject: Hello there",
  "Date: Mon, 18 May 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: text/html; charset="utf-8"',
  "",
  "<html><body><p>Hello <b>world</b></p></body></html>",
  "",
].join("\r\n");

const TEXT_EML = [
  "From: alice@example.com",
  "To: bob@example.com",
  "Subject: Plain message",
  "Date: Tue, 19 May 2026 09:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "This is a plain-text email body.",
  "",
].join("\r\n");

const INLINE_IMAGE_EML = [
  "From: alice@example.com",
  "To: bob@example.com",
  "Subject: With inline image",
  "MIME-Version: 1.0",
  'Content-Type: multipart/related; boundary="BOUNDARY"',
  "",
  "--BOUNDARY",
  'Content-Type: text/html; charset="utf-8"',
  "",
  '<html><body><img src="cid:logo@example.com"></body></html>',
  "--BOUNDARY",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <logo@example.com>",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "--BOUNDARY--",
  "",
].join("\r\n");

describe("EmlPreview", () => {
  it("renders parsed headers and a sandboxed iframe for HTML body", async () => {
    mockFetchEml(HTML_EML);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview")).toBeInTheDocument(),
    );

    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/Carol/)).toBeInTheDocument();

    const iframe = await screen.findByTestId("eml-preview-html");
    expect(iframe.tagName).toBe("IFRAME");
    // Sandbox must be set in JSX, not patched post-mount — otherwise the
    // first parse of `srcdoc` runs unsandboxed. `sandbox=""` is the most
    // restrictive value: no scripts, no same-origin, null-origin doc. A
    // sanitizer bypass therefore cannot read parent cookies/localStorage.
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("srcdoc") ?? "").toContain("Hello");
  });

  it("falls back to text body when no HTML part is present", async () => {
    mockFetchEml(TEXT_EML);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview-text")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("eml-preview-text").textContent).toContain(
      "This is a plain-text email body.",
    );
    expect(screen.queryByTestId("eml-preview-html")).not.toBeInTheDocument();
  });

  it("opens a clicked attachment in the inline preview with a back button", async () => {
    mockFetchEml(INLINE_IMAGE_EML);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    const attachmentButton = await screen.findByRole("button", {
      name: /logo\.png/,
    });
    fireEvent.click(attachmentButton);

    expect(screen.getByTestId("eml-attachment-preview")).toBeInTheDocument();
    expect(
      screen.queryByTestId("eml-preview-attachments"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("eml-preview-html")).not.toBeInTheDocument();

    const backButton = screen.getByRole("button", { name: /back to email/i });
    fireEvent.click(backButton);

    expect(
      screen.queryByTestId("eml-attachment-preview"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("eml-preview-attachments")).toBeInTheDocument();
  });

  it("rewrites inline cid: image references to blob URLs", async () => {
    mockFetchEml(INLINE_IMAGE_EML);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    const iframe = await screen.findByTestId("eml-preview-html");
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(createdBlobUrls.length).toBeGreaterThan(0);
    expect(srcdoc).toContain(createdBlobUrls[0]);
    expect(srcdoc).not.toContain("cid:logo@example.com");
  });

  it("falls back to the preview-unavailable state when MIME is malformed", async () => {
    const malformed = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]).buffer;
    mockFetchEml(malformed);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    await waitFor(() => {
      expect(screen.getByTestId("eml-preview-error")).toBeInTheDocument();
    });
  });

  it("strips script tags and renders inside a no-allow-scripts sandbox", async () => {
    const scriptEml = [
      "From: a@example.com",
      "To: b@example.com",
      "Subject: with script",
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="utf-8"',
      "",
      "<html><body><p>Visible content</p><script>window.__pwned=true</script></body></html>",
      "",
    ].join("\r\n");
    mockFetchEml(scriptEml);
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    const iframe = await screen.findByTestId("eml-preview-html");
    // Sandbox is `""` (no flags) so the iframe doc is null-origin: no
    // scripts, no parent-cookie access. Must be set on the JSX element so
    // srcdoc is never parsed in an unsandboxed state.
    expect(iframe.getAttribute("sandbox")).toBe("");
    const srcdoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcdoc.toLowerCase()).not.toContain("<script");
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it("routes to the thread view when the outer .eml has empty body + nested message/rfc822 parts", async () => {
    const threadEml = [
      "Subject: Re: Kickoff",
      "Date: Mon, 18 May 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="OUTER"',
      "",
      "--OUTER",
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="msg-1.eml"',
      "",
      "From: Alice <alice@example.com>",
      "Subject: Kickoff",
      "Date: Mon, 11 May 2026 09:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "First message body — alpha token.",
      "",
      "--OUTER",
      "Content-Type: message/rfc822",
      'Content-Disposition: attachment; filename="msg-2.eml"',
      "",
      "From: Bob <bob@example.com>",
      "Subject: Re: Kickoff",
      "Date: Mon, 18 May 2026 09:30:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Reply body — beta token.",
      "",
      "--OUTER--",
      "",
    ].join("\r\n");
    mockFetchEml(threadEml);

    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    // Container with `data-testid="eml-thread"` proves `isThreadShape`
    // detected the synthesized-thread shape and routed to `EmlThreadBody`.
    // The exhaustive nested-section render is verified end-to-end by the
    // office-addin's parseEmlBytes + synthesizeThreadEml round-trip tests
    // and the backend's `test_xberg_extracts_nested_rfc822_thread_bundle`
    // — covering the same contract from both directions without depending
    // on jsdom's blob-URL fetch shim.
    await waitFor(() =>
      expect(screen.getByTestId("eml-thread")).toBeInTheDocument(),
    );
    // The flat-attachment list must not appear for thread-shape emls.
    expect(screen.queryByTestId("eml-preview-attachments")).toBeNull();
  });

  it("shows a preview-unavailable fallback when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    renderEml(<EmlPreview filename={FILE.filename} url={FILE.url} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview-error")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Preview unavailable: this email could not be parsed."),
    ).toBeInTheDocument();
  });
});
