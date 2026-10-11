/** Each Word document's last chat, keyed by a hash of its URL so no document path is stored. */
export const WORD_DOCUMENT_CHATS_KEY = "erato.addin.word.documentChats.v1";

export const WORD_DOCUMENT_CHATS_MAX_ENTRIES = 200;
export const WORD_DOCUMENT_CHATS_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

const PANE_SESSION_PREFIX = "pane-session:";
const DOCUMENT_KEY_PATTERN = /^[0-9a-f]{64}$/;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

interface WordDocumentChatEntry {
  chatId: string;
  usedAt: number;
}

function isEntry(value: unknown): value is WordDocumentChatEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.chatId === "string" &&
    candidate.chatId.length > 0 &&
    typeof candidate.usedAt === "number" &&
    Number.isFinite(candidate.usedAt)
  );
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** One spelling per document: Word reports the same file with differing case, separators and escaping. */
export function normalizeWordDocumentUrl(url: string): string {
  // "#" is legal in a local file name, so only a scheme URL has a query or fragment to drop.
  const withoutQuery = URL_SCHEME_PATTERN.test(url)
    ? (url.split(/[?#]/, 1)[0] ?? url)
    : url;
  return withoutQuery
    .replace(/\\/g, "/")
    .split("/")
    .map(decodeSegment)
    .join("/")
    .toLowerCase();
}

/** Null for an unsaved document, or when hashing is unavailable: such a pane always starts a new chat. */
export async function wordDocumentChatKey(
  identity: string,
): Promise<string | null> {
  if (identity.length === 0 || identity.startsWith(PANE_SESSION_PREFIX)) {
    return null;
  }
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(normalizeWordDocumentUrl(identity)),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

function readEntries(now: number): Map<string, WordDocumentChatEntry> {
  const entries = new Map<string, WordDocumentChatEntry>();
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(WORD_DOCUMENT_CHATS_KEY);
    if (raw === null) return entries;
    parsed = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return entries;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (
      DOCUMENT_KEY_PATTERN.test(key) &&
      isEntry(value) &&
      now - value.usedAt <= WORD_DOCUMENT_CHATS_MAX_AGE_MS
    ) {
      entries.set(key, { chatId: value.chatId, usedAt: value.usedAt });
    }
  }
  return entries;
}

function writeEntries(entries: Map<string, WordDocumentChatEntry>): void {
  const kept = [...entries]
    .sort(([, left], [, right]) => right.usedAt - left.usedAt)
    .slice(0, WORD_DOCUMENT_CHATS_MAX_ENTRIES);
  try {
    localStorage.setItem(
      WORD_DOCUMENT_CHATS_KEY,
      JSON.stringify(Object.fromEntries(kept)),
    );
  } catch {
    // Quota or blocked storage: the pane keeps working, the document just won't resume.
  }
}

export function readWordDocumentChat(
  documentKey: string,
  now = Date.now(),
): string | null {
  return readEntries(now).get(documentKey)?.chatId ?? null;
}

export function recordWordDocumentChat(
  documentKey: string,
  chatId: string,
  now = Date.now(),
): void {
  const entries = readEntries(now);
  entries.set(documentKey, { chatId, usedAt: now });
  writeEntries(entries);
}

/** Only drops the entry while it still names `chatId`; another pane may have moved it on. */
export function forgetWordDocumentChat(
  documentKey: string,
  chatId: string,
  now = Date.now(),
): void {
  const entries = readEntries(now);
  if (entries.get(documentKey)?.chatId !== chatId) return;
  entries.delete(documentKey);
  writeEntries(entries);
}
