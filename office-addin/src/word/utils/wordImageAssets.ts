import { fetchGetFile } from "@erato/frontend/library";

import { wordImageDimensions } from "./wordMediaContent";

import type {
  WordImageAsset,
  WordImageAssetIssue,
  WordImageAssetCapture,
} from "./wordImageAssetData";
export {
  resolveWordImageAsset,
  wordImageAssetMetadata,
} from "./wordImageAssetData";
export type {
  WordImageAsset,
  WordImageAssetIssue,
  WordImageAssetCapture,
} from "./wordImageAssetData";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ASSETS = 20;
class AssetFailure extends Error {
  constructor(readonly reason: WordImageAssetIssue["reason"]) {
    super(reason);
  }
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES)
    throw new AssetFailure("too-large");
  if (!response.body) throw new AssetFailure("invalid-image");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let lengthRead = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      lengthRead += next.value.byteLength;
      if (lengthRead > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new AssetFailure("too-large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(lengthRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mimeType(bytes: Uint8Array): WordImageAsset["mime"] | undefined {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return "image/gif";
  return undefined;
}

/** Only IDs attached to this send are resolved; model URLs are never fetched. */
export async function captureWordImageAssets(
  inputFileIds: readonly string[] | undefined,
): Promise<WordImageAssetCapture> {
  const result: WordImageAssetCapture = { assets: [], unavailable: [] };
  let totalBytes = 0;
  const ids = [...new Set(inputFileIds ?? [])];
  const deadline = Date.now() + 15000;
  for (const fileId of ids) {
    if (Date.now() >= deadline) {
      result.unavailable.push({ fileId, reason: "unavailable" });
      continue;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, deadline - Date.now()),
    );
    let name: string | undefined;
    try {
      const file = await fetchGetFile(
        { pathParams: { fileId } },
        controller.signal,
      );
      if (file.id !== fileId) throw new AssetFailure("unavailable");
      name = file.filename;
      // Unrelated attachments still travel through the ordinary chat upload path.
      if (
        file.file_capability.id !== "image" &&
        !file.file_capability.operations.includes("analyze_image")
      )
        continue;
      if (
        file.file_contents_unavailable_missing_permissions ||
        !file.download_url
      )
        throw new AssetFailure("unavailable");
      if (result.assets.length >= MAX_ASSETS || totalBytes >= MAX_ASSET_BYTES)
        throw new AssetFailure("too-large");
      const url = new URL(file.download_url, window.location.href);
      const sameOrigin = url.origin === window.location.origin;
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (!sameOrigin && url.protocol !== "https:")
      )
        throw new AssetFailure("unavailable");
      const response = await fetch(url.href, {
        signal: controller.signal,
        credentials: sameOrigin ? "same-origin" : "omit",
        redirect: "error",
      });
      if (!response.ok) throw new AssetFailure("unavailable");
      const declared = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (
        declared &&
        ![
          "image/png",
          "image/jpeg",
          "image/gif",
          "application/octet-stream",
        ].includes(declared)
      )
        throw new AssetFailure("unsupported");
      const bytes = await boundedBytes(response);
      if (!bytes.length) throw new AssetFailure("invalid-image");
      if (totalBytes + bytes.byteLength > MAX_ASSET_BYTES)
        throw new AssetFailure("too-large");
      const mime = mimeType(bytes);
      if (
        !mime ||
        (declared &&
          declared !== "application/octet-stream" &&
          declared !== mime)
      )
        throw new AssetFailure("invalid-image");
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const base64 = btoa(binary);
      const dimensions = wordImageDimensions({ mime, base64 });
      if (!dimensions) throw new AssetFailure("invalid-image");
      totalBytes += bytes.length;
      result.assets.push(
        Object.freeze({
          ref: `asset_${result.assets.length + 1}`,
          fileId,
          name: file.filename,
          mime,
          base64,
          ...dimensions,
          sizeBytes: bytes.byteLength,
        }),
      );
    } catch (error) {
      result.unavailable.push({
        fileId,
        ...(name ? { name } : {}),
        reason: error instanceof AssetFailure ? error.reason : "unavailable",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
  return result;
}
