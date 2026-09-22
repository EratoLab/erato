/**
 * Send-time identity of the document the pane is attached to, and the document
 * name that rides both Word facets.
 *
 * Nothing here is written into the file. `Office.context.document.settings`
 * would persist into the .docx and is forbidden on this path.
 */

/** The document URL, or null when the host does not expose one (unsaved). */
function documentUrl(): string | null {
  const url = (
    Office as unknown as {
      context?: { document?: { url?: string | null } };
    }
  ).context?.document?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * URL when the document is saved, `pane-session:<uuid>` when it is not.
 *
 * Call once per pane load and hold the result in memory: a fresh token per
 * send would make every stored stamp stale, and ERMAIN-822's apply gate fails
 * closed on a mismatch.
 */
export function resolveWordDocumentIdentity(): string {
  return documentUrl() ?? `pane-session:${globalThis.crypto.randomUUID()}`;
}

/**
 * Document name as Word reports it: the file name.
 *
 * There is no `Word.Document.name` at any requirement set (verified against
 * `@types/office-js`), and `Word.Document.properties.title` is optional
 * metadata that is usually empty and often wrong — so the name is derived from
 * the document URL. Splits on both separators because Word on Windows desktop
 * reports a local path, not a URL, and percent-decodes because SharePoint URLs
 * are encoded.
 *
 * Returns `""` for an unsaved document rather than inventing a placeholder:
 * the value reaches the model through ERMAIN-820's template.
 */
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
