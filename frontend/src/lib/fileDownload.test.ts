import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fileFetch,
  installHostShell,
  removeHostShell,
} from "@/test/hostShellStub";

import { MAX_HOST_FILE_BYTES, downloadFile } from "./fileDownload";

const CSV = "city,country\nBern,CH\n";
const CSV_BASE64 = globalThis.btoa(CSV);

const respond = (body: string, headers: Record<string, string> = {}) =>
  fileFetch(body, "text/csv", headers);

/** Lets every pending promise and the helper's fallback run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const anchor = () => {
  const button = document.createElement("button");
  button.getBoundingClientRect = () => new DOMRect(10, 20, 30, 40);
  return button;
};

afterEach(() => {
  removeHostShell();
  vi.unstubAllGlobals();
});

describe("downloadFile", () => {
  it("downloads in the click itself where no host app offers files", () => {
    const fetchSpy = respond(CSV);
    vi.stubGlobal("fetch", fetchSpy);
    installHostShell({ shareSheet: 1 });
    const browserDownload = vi.fn();

    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);

    expect(browserDownload).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the file with the page's session and hands it to the host app", async () => {
    const fetchSpy = respond(CSV);
    vi.stubGlobal("fetch", fetchSpy);
    const request = installHostShell({ files: 1 });
    const browserDownload = vi.fn();

    downloadFile(
      { name: "cities.csv", content: "/api/v1beta/files/1/preview" },
      browserDownload,
      anchor(),
    );

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledExactlyOnceWith("files.share", {
        fileName: "cities.csv",
        contentType: "text/csv",
        data: CSV_BASE64,
        anchor: { x: 10, y: 20, width: 30, height: 40 },
      });
    });
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1beta/files/1/preview");
    expect(browserDownload).not.toHaveBeenCalled();
  });

  it("hands over bytes the page already holds", async () => {
    const fetchSpy = respond(CSV);
    vi.stubGlobal("fetch", fetchSpy);
    const request = installHostShell({ files: 1 });

    downloadFile({ name: "chart.png", content: new Blob([CSV]) }, vi.fn());

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledExactlyOnceWith("files.share", {
        fileName: "chart.png",
        contentType: undefined,
        data: CSV_BASE64,
        anchor: undefined,
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the browser download for a file over the limit", async () => {
    const tooLong = String(MAX_HOST_FILE_BYTES + 1);
    vi.stubGlobal("fetch", respond(CSV, { "content-length": tooLong }));
    const request = installHostShell({ files: 1 });
    const browserDownload = vi.fn();

    downloadFile({ name: "big.csv", content: "/big" }, browserDownload);

    await vi.waitFor(() => {
      expect(browserDownload).toHaveBeenCalledOnce();
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("falls back to the browser download when the host app refuses", async () => {
    vi.stubGlobal("fetch", respond(CSV));
    installHostShell(
      { files: 1 },
      vi.fn(() => Promise.reject({ code: "unavailable", message: "busy" })),
    );
    const browserDownload = vi.fn();

    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);

    await vi.waitFor(() => {
      expect(browserDownload).toHaveBeenCalledOnce();
    });
  });

  it("falls back to the browser download when the file cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 403 }))),
    );
    const request = installHostShell({ files: 1 });
    const browserDownload = vi.fn();

    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);

    await vi.waitFor(() => {
      expect(browserDownload).toHaveBeenCalledOnce();
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("does nothing more when the person closes the sheet", async () => {
    vi.stubGlobal("fetch", respond(CSV));
    const request = installHostShell(
      { files: 1 },
      vi.fn(() => Promise.resolve({ completed: false })),
    );
    const browserDownload = vi.fn();

    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);

    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledOnce();
    });
    await settled();
    expect(browserDownload).not.toHaveBeenCalled();
  });

  it("falls back for a file found over the limit once read", async () => {
    vi.stubGlobal("fetch", respond("x".repeat(MAX_HOST_FILE_BYTES + 1)));
    const request = installHostShell({ files: 1 });
    const browserDownload = vi.fn();

    downloadFile({ name: "big.csv", content: "/big" }, browserDownload);

    await vi.waitFor(() => {
      expect(browserDownload).toHaveBeenCalledOnce();
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("ignores a second tap while a file is on its way", async () => {
    vi.stubGlobal("fetch", respond(CSV));
    let close: (value: unknown) => void = () => undefined;
    const request = installHostShell(
      { files: 1 },
      vi.fn(() => new Promise((resolve) => (close = resolve))),
    );
    const browserDownload = vi.fn();

    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledOnce();
    });
    downloadFile({ name: "cities.csv", content: "/f" }, browserDownload);
    expect(fetch).toHaveBeenCalledOnce();
    close({ completed: true });
    await settled();

    expect(request).toHaveBeenCalledOnce();
    expect(browserDownload).not.toHaveBeenCalled();
  });

  it("downloads in the browser when the file has no address", () => {
    const request = installHostShell({ files: 1 });
    const browserDownload = vi.fn();

    downloadFile({ name: "image-1", content: "" }, browserDownload);

    expect(browserDownload).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });
});
