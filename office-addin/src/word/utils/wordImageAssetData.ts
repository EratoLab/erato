import type { WordImageSpec } from "./wordMediaContent";

export interface WordImageAsset {
  ref: string;
  /** Host-only ownership; never accepted from model output. */
  fileId: string;
  name: string;
  mime: NonNullable<WordImageSpec["data"]>["mime"];
  /** Host-only immutable bytes, never included in the document read tool. */
  base64: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}
export interface WordImageAssetIssue {
  fileId: string;
  name?: string;
  reason: "unavailable" | "unsupported" | "too-large" | "invalid-image";
}
export interface WordImageAssetCapture {
  assets: WordImageAsset[];
  unavailable: WordImageAssetIssue[];
}

export function wordImageAssetMetadata(asset: WordImageAsset) {
  return {
    ref: asset.ref,
    name: asset.name,
    mime: asset.mime,
    widthPx: asset.widthPx,
    heightPx: asset.heightPx,
    sizeBytes: asset.sizeBytes,
  };
}

/** Materialize only the captured attachment; unknown references cannot become bytes. */
export function resolveWordImageAsset(
  spec: WordImageSpec,
  assets: readonly WordImageAsset[] | undefined,
): WordImageSpec {
  if (!spec.assetRef) return spec;
  const asset = assets?.find((item) => item.ref === spec.assetRef);
  if (!asset)
    throw new Error(
      "Image attachment was not captured for this document proposal",
    );
  const { assetRef: _assetRef, ...rest } = spec;
  return { ...rest, data: { mime: asset.mime, base64: asset.base64 } };
}
