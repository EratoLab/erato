import { cleanServerText, isRecord } from "./serverText";

/** The backend reads at most this many link blocks from one result. */
const MAX_LINKS_READ = 100;
/** Twice the backend's cap on a stored URI. */
const MAX_URI_CHARS = 1_024;

export interface ResultLink {
  href: string;
  /** The host the browser opens, with a port other than the default. */
  host: string;
  /** Whether the server's own host serves the link, by the stored check and the URL itself. */
  onServer: boolean;
  title?: string;
}

const readLink = (raw: unknown): ResultLink | undefined => {
  if (!isRecord(raw) || typeof raw.uri !== "string") return undefined;
  if (raw.uri.length > MAX_URI_CHARS || !raw.uri.startsWith("https://")) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw.uri);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return undefined;
  }
  if (url.hostname.length === 0) return undefined;
  const storedHost =
    typeof raw.host === "string" ? raw.host.toLowerCase() : undefined;
  const title =
    cleanServerText(raw.title).text || cleanServerText(raw.name).text;
  return {
    href: url.href,
    host: url.host,
    // A stored claim the URL contradicts counts for nothing.
    onServer: raw.matches_server_host === true && storedHost === url.hostname,
    title: title.length > 0 ? title : undefined,
  };
};

/**
 * The first link of a result that may become an anchor: an https URL without
 * user info. Anything else a stored row or event carries is not a link.
 */
export const resultLinkOf = (details: unknown): ResultLink | undefined => {
  const links = isRecord(details) ? details.links : undefined;
  if (!Array.isArray(links)) return undefined;
  for (const link of links.slice(0, MAX_LINKS_READ)) {
    const read = readLink(link);
    if (read) return read;
  }
  return undefined;
};
