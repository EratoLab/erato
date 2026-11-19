import type { McpUiDownloadFileRequest } from "@modelcontextprotocol/ext-apps/app-bridge";

/** The file types a view may save, with the extension each file gets. */
const SAVED_TYPES: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/svg+xml": ".svg",
};

/** The largest file a view may save: 10 MiB. */
export const MAX_VIEW_DOWNLOAD_BYTES = 10 * 1024 * 1024;

/** The longest file name a view's file is saved under, before its extension. */
const MAX_FILE_NAME_CHARS = 100;

/** The name of a file whose URI names none. */
const FALLBACK_FILE_NAME = "download";

/**
 * Control and format characters, such as a right-to-left override, and the
 * characters file systems refuse in a name.
 */
const UNSAFE_NAME_CHARS = /[\p{Cc}\p{Cf}<>:"/\\|?*]/gu;

/** How long a saved file's object URL is kept once its download started. */
const REVOKE_AFTER_MS = 40_000;

/** A file a view asked to save, checked. */
export interface ViewDownload {
  /** The name it is saved under, with the extension of its type. */
  name: string;
  /** Its bytes, as a type no browser shows, so the URL only downloads. */
  blob: Blob;
}

type DownloadContents = McpUiDownloadFileRequest["params"]["contents"];

/**
 * The name a file the view names with `uri` is saved under: the URI's last
 * path segment, decoded, without the characters a name must not hold or
 * leading and trailing dots and spaces, at most `MAX_FILE_NAME_CHARS`
 * long, and always ending in `extension`.
 */
export const viewDownloadName = (uri: string, extension: string): string => {
  const segment = uri.split(/[?#]/, 1)[0].split("/").pop() ?? "";
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Kept as written.
  }
  const trim = (name: string) => name.replace(/^[\s.]+|[\s.]+$/g, "");
  const cleaned = trim(decoded.replace(UNSAFE_NAME_CHARS, ""));
  const stem = cleaned.toLowerCase().endsWith(extension)
    ? trim(cleaned.slice(0, -extension.length))
    : cleaned;
  const short = trim(Array.from(stem).slice(0, MAX_FILE_NAME_CHARS).join(""));
  return `${short || FALLBACK_FILE_NAME}${extension}`;
};

/**
 * Base64 holds 3 bytes in every 4 characters: data over twice as long as
 * the largest file in base64 is not decoded at all. The decoded size is the
 * one that counts.
 */
const MAX_BASE64_CHARS = Math.ceil(MAX_VIEW_DOWNLOAD_BYTES / 3) * 4 * 2;

/** The bytes of base64 `data`, or none when it is not base64. */
const decodeBase64 = (data: string) => {
  try {
    return Uint8Array.from(globalThis.atob(data), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
};

/**
 * The file a view's `ui/download-file` asks to save, when the host saves it:
 * one embedded resource, as text or base64, a PNG or SVG of at most
 * `MAX_VIEW_DOWNLOAD_BYTES`. A link to a resource, which the host would
 * have to fetch, any other type, a larger file and several files are not.
 */
export const viewDownloadOf = (
  contents: DownloadContents,
): ViewDownload | undefined => {
  if (contents.length !== 1) return undefined;
  const [item] = contents;
  if (item.type !== "resource") return undefined;
  const { resource } = item;
  const mimeType = resource.mimeType?.split(";", 1)[0].trim().toLowerCase();
  const extension = mimeType ? SAVED_TYPES[mimeType] : undefined;
  if (!extension) return undefined;
  const bytes =
    "blob" in resource
      ? resource.blob.length <= MAX_BASE64_CHARS
        ? decodeBase64(resource.blob)
        : undefined
      : resource.text;
  if (bytes === undefined) return undefined;
  // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  if (blob.size > MAX_VIEW_DOWNLOAD_BYTES) return undefined;
  return { name: viewDownloadName(resource.uri, extension), blob };
};

/** Saves `file` to the user's device, as the browser saves downloads. */
export const saveViewDownload = ({ name, blob }: ViewDownload) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, REVOKE_AFTER_MS);
};
