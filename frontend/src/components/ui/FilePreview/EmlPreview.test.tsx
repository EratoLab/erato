import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { EmlPreview } from "./EmlPreview";

import type React from "react";

const renderEml = (ui: React.ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>);

const FILE = {
  id: "file_eml_1",
  filename: "message.eml",
  download_url: "https://files.example.com/message.eml",
};

const stringToBuffer = (s: string): ArrayBuffer => {
  const encoded = new TextEncoder().encode(s);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
};

const mockFetchEml = (bytes: ArrayBuffer | string) => {
  const buffer = typeof bytes === "string" ? stringToBuffer(bytes) : bytes;
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => buffer,
  });
};

let blobUrlCounter = 0;
const createdBlobUrls: string[] = [];

beforeEach(() => {
  blobUrlCounter = 0;
  createdBlobUrls.length = 0;
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
    value: () => {
      const url = `blob:mock/${++blobUrlCounter}`;
      createdBlobUrls.push(url);
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
    renderEml(<EmlPreview file={FILE} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview")).toBeInTheDocument(),
    );

    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/Carol/)).toBeInTheDocument();

    await waitFor(() => {
      const iframe = screen
        .getByTestId("eml-preview-html")
        .querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    });

    const iframe = screen
      .getByTestId("eml-preview-html")
      .querySelector("iframe");
    expect(iframe?.getAttribute("srcdoc") ?? "").toContain("Hello");
  });

  it("falls back to text body when no HTML part is present", async () => {
    mockFetchEml(TEXT_EML);
    renderEml(<EmlPreview file={FILE} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview-text")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("eml-preview-text").textContent).toContain(
      "This is a plain-text email body.",
    );
    expect(screen.queryByTestId("eml-preview-html")).not.toBeInTheDocument();
  });

  it("rewrites inline cid: image references to blob URLs", async () => {
    mockFetchEml(INLINE_IMAGE_EML);
    renderEml(<EmlPreview file={FILE} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview-html")).toBeInTheDocument(),
    );

    const iframe = screen
      .getByTestId("eml-preview-html")
      .querySelector("iframe");
    const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
    expect(createdBlobUrls.length).toBeGreaterThan(0);
    expect(srcdoc).toContain(createdBlobUrls[0]);
    expect(srcdoc).not.toContain("cid:logo@example.com");
  });

  it("renders without crashing when fed a malformed MIME body", async () => {
    const malformed = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]).buffer;
    mockFetchEml(malformed);
    renderEml(<EmlPreview file={FILE} />);

    // Either an explicit error fallback or a ready-but-empty preview is
    // acceptable here; postal-mime is permissive enough that some garbage
    // still parses as an empty envelope. The point is: no crash.
    await waitFor(() => {
      const error = screen.queryByTestId("eml-preview-error");
      const ready = screen.queryByTestId("eml-preview");
      expect(error ?? ready).not.toBeNull();
    });
  });

  it("shows a preview-unavailable fallback when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    renderEml(<EmlPreview file={FILE} />);

    await waitFor(() =>
      expect(screen.getByTestId("eml-preview-error")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Preview unavailable: this email could not be parsed."),
    ).toBeInTheDocument();
  });
});
