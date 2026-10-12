import { callOfficeAsync } from "../../utils/officeAsync";

/** Document identity stays in pane memory; do not persist tracking IDs into the DOCX. */

const LIVE_URL_TIMEOUT_MS = 2000;

interface OfficeDocumentLike {
  url?: string | null;
  getFilePropertiesAsync?: (
    callback: (result: Office.AsyncResult<Office.FileProperties>) => void,
  ) => void;
}

function officeDocument(): OfficeDocumentLike | undefined {
  return (
    Office as unknown as {
      context?: { document?: OfficeDocumentLike };
    }
  ).context?.document;
}

function documentUrl(): string | null {
  const url = officeDocument()?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** Mint once per pane load; minting per send would invalidate earlier cards. */
export function resolveWordDocumentIdentity(): string {
  return documentUrl() ?? `pane-session:${globalThis.crypto.randomUUID()}`;
}

let paneIdentity: string | null = null;

/** The pane's identity, shared by the session controller and the chat host. */
export function getWordDocumentIdentity(): string {
  paneIdentity ??= resolveWordDocumentIdentity();
  return paneIdentity;
}

export function resetWordDocumentIdentityForTests(): void {
  paneIdentity = null;
}

/** `document.url` is fixed at pane load; the file properties also see a later save. */
export async function readLiveWordDocumentUrl(): Promise<string | null> {
  const document = officeDocument();
  const getFileProperties = document?.getFilePropertiesAsync;
  if (typeof getFileProperties === "function") {
    try {
      const properties = await callOfficeAsync<Office.FileProperties>(
        (callback) => getFileProperties.call(document, callback),
        { timeoutMs: LIVE_URL_TIMEOUT_MS },
      );
      const url = (properties as { url?: unknown } | null)?.url;
      if (typeof url === "string" && url.length > 0) return url;
    } catch {
      // Hosts without file properties still report the load-time URL.
    }
  }
  return documentUrl();
}

/** Use the URL filename: properties.title is optional metadata. Local paths may use either separator. */
export function resolveWordDocumentName(): string {
  const url = documentUrl();
  if (url === null) return "";
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? url;
  const lastSegment = withoutQuery.split(/[/\\]/).pop() ?? "";
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    // A stray "%" in a local file name makes decodeURIComponent throw.
    return lastSegment;
  }
}
