import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureWordImageAssets,
  resolveWordImageAsset,
  wordImageAssetMetadata,
} from "../wordImageAssets";

const metadata = vi.hoisted(() => vi.fn());
vi.mock("@erato/frontend/library", () => ({ fetchGetFile: metadata }));
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const bytes = Uint8Array.from(atob(png), (s) => s.charCodeAt(0));
const file = (
  id = "file1",
  url = "https://storage.example.test/image.png",
) => ({
  id,
  filename: "diagram.png",
  download_url: url,
  file_contents_unavailable_missing_permissions: false,
  file_capability: {
    id: "image",
    operations: ["analyze_image"],
    extensions: ["png"],
    mime_types: ["image/png"],
  },
});
const fetcher = vi.fn();
beforeEach(() => {
  metadata.mockReset();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe("attached Word image assets", () => {
  it("captures only attached IDs through the authenticated metadata API and excludes credentials from signed storage requests", async () => {
    metadata.mockResolvedValue(file());
    fetcher.mockResolvedValue(
      new Response(bytes, { headers: { "content-type": "image/png" } }),
    );
    const result = await captureWordImageAssets(["file1", "file1"]);
    expect(metadata).toHaveBeenCalledOnce();
    expect(metadata.mock.calls[0][0]).toEqual({
      pathParams: { fileId: "file1" },
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://storage.example.test/image.png",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    expect(result.unavailable).toEqual([]);
    expect(result.assets[0]).toMatchObject({
      ref: "asset_1",
      fileId: "file1",
      widthPx: 1,
      heightPx: 1,
      mime: "image/png",
      base64: png,
    });
    const exposed = wordImageAssetMetadata(result.assets[0]);
    expect(exposed).not.toHaveProperty("base64");
    expect(exposed).not.toHaveProperty("fileId");
    expect(Object.isFrozen(result.assets[0])).toBe(true);
    expect(
      resolveWordImageAsset(
        { assetRef: "asset_1", widthPt: 80 },
        result.assets,
      ),
    ).toEqual({ data: { mime: "image/png", base64: png }, widthPt: 80 });
    expect(() =>
      resolveWordImageAsset({ assetRef: "model_invented" }, result.assets),
    ).toThrow("not captured");
  });

  it("uses ordinary same-origin session cookies for backend-proxied downloads", async () => {
    metadata.mockResolvedValue(file("file1", "/api/download/image.png"));
    fetcher.mockResolvedValue(
      new Response(bytes, {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    const result = await captureWordImageAssets(["file1"]);
    expect(result.assets).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      new URL("/api/download/image.png", window.location.href).href,
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("does not download unrelated attachments or metadata for a different file ID", async () => {
    metadata
      .mockResolvedValueOnce({
        ...file("text"),
        file_capability: { id: "word", operations: ["extract_text"] },
      })
      .mockResolvedValueOnce(file("wrong-id"));
    const result = await captureWordImageAssets(["text", "actual-id"]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.assets).toEqual([]);
    expect(result.unavailable).toEqual([
      { fileId: "actual-id", reason: "unavailable" },
    ]);
  });

  it("rejects unexpected MIME, mismatched bytes, empty downloads, missing permissions and over-size streams", async () => {
    metadata.mockImplementation(
      async ({ pathParams }: { pathParams: { fileId: string } }) =>
        pathParams.fileId === "forbidden"
          ? {
              ...file("forbidden"),
              file_contents_unavailable_missing_permissions: true,
            }
          : file(pathParams.fileId),
    );
    fetcher
      .mockResolvedValueOnce(
        new Response("<html>Login</html>", {
          headers: { "content-type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { "content-type": "image/jpeg" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(), {
          headers: { "content-type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "content-length": String(4 * 1024 * 1024 + 1),
          },
        }),
      );
    const result = await captureWordImageAssets([
      "html",
      "wrongmime",
      "empty",
      "large",
      "forbidden",
    ]);
    expect(result.assets).toEqual([]);
    expect(result.unavailable.map((e) => e.reason)).toEqual([
      "unsupported",
      "invalid-image",
      "invalid-image",
      "too-large",
      "unavailable",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("never follows arbitrary protocol or cross-origin cleartext download locations", async () => {
    for (const url of [
      "file:///etc/passwd",
      "data:image/png;base64," + png,
      "http://storage.example.test/file.png",
      "https://user:secret@storage.example.test/file.png",
    ]) {
      metadata.mockResolvedValue(file("file1", url));
      expect((await captureWordImageAssets(["file1"])).assets).toEqual([]);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
