/** Document identity stays in pane memory; do not persist tracking IDs into the DOCX. */

function documentUrl(): string | null {
  const url = (
    Office as unknown as {
      context?: { document?: { url?: string | null } };
    }
  ).context?.document?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/** Mint once per pane load; minting per send would invalidate earlier cards. */
export function resolveWordDocumentIdentity(): string {
  return documentUrl() ?? `pane-session:${globalThis.crypto.randomUUID()}`;
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
