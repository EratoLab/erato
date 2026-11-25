import { createLogger } from "@/utils/debugLogger";
import { encodeBase64 } from "@/utils/file/encodeBase64";

import { hostShellWithCapability } from "./hostShell";

import type { HostShell } from "./hostShell";

const logger = createLogger("UI", "fileDownload");

const FILES_CAPABILITY = "files";
const FILES_SHARE = "files.share";

/** The largest file a host app's `files: 1` takes: 25 MiB. */
export const MAX_HOST_FILE_BYTES = 25 * 1024 * 1024;

/** A file the person asked to download. */
export interface DownloadableFile {
  /** The name it is saved under. */
  name: string;
  /**
   * Its bytes, or an address this page reads them from with its own
   * session: the server's own address works behind a per-app VPN and needs
   * no cross-origin access.
   */
  content: Blob | string;
}

/**
 * Downloads `file` where this page runs. In a host app that offers `files`,
 * the app's share sheet gets the file (Save to Files, mail, other apps);
 * anywhere else, or when that fails, `browserDownload` runs, which is what
 * the browser did before. Call it from the click's own handler, where a
 * browser download may start.
 */
export function downloadFile(
  file: DownloadableFile,
  browserDownload: () => void,
  anchor?: Element | null,
): void {
  const shell = hostShellWithCapability(FILES_CAPABILITY, 1);
  if (!shell) {
    browserDownload();
    return;
  }
  // Measured now: the anchor may be gone by the time the bytes are read.
  const rect = anchor?.getBoundingClientRect();
  shareThroughHost(shell, file, rect).catch((error: unknown) => {
    logger.warn("host app did not take the file", error);
    browserDownload();
  });
}

async function shareThroughHost(
  shell: HostShell,
  { name, content }: DownloadableFile,
  rect: DOMRect | undefined,
): Promise<void> {
  const blob = typeof content === "string" ? await read(content) : content;
  if (blob.size > MAX_HOST_FILE_BYTES) {
    throw new Error(`${name} is larger than the host app takes`);
  }
  await shell.request(FILES_SHARE, {
    fileName: name,
    contentType: blob.type || undefined,
    data: await encodeBase64(blob),
    anchor: rect && {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  });
}

/** Reads `url`, giving up before the body when its length is over the limit. */
async function read(url: string): Promise<Blob> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) {
    throw new Error(`reading the file failed: ${response.status}`);
  }
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_HOST_FILE_BYTES) {
    controller.abort();
    throw new Error("the file is larger than the host app takes");
  }
  return response.blob();
}
