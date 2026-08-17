/**
 * Answers a desktop sidecar produced on the device that the user chose NOT to
 * share with the server-side assistant.
 *
 * When a sidecar tool asks for consent, the on-device answer already exists
 * client-side. Declining stops it from reaching the backend — it must not
 * throw the answer away. These entries keep it on the device that made it,
 * rendered as an explicitly non-transcript surface: the server history
 * truthfully records only the decline.
 *
 * Pure model (no React, no storage side effects beyond the persisted-state
 * options) so the lifecycle rules are unit-testable.
 */

/** Chat key used before a brand-new chat has its server id. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- storage key
export const NEW_CHAT_LOCAL_ANSWER_KEY = "__new_chat__";

export const SIDECAR_LOCAL_ANSWERS_KEY = "erato.desktopSidecar.localAnswers";

const MAX_PER_CHAT = 3;
const MAX_TOTAL = 30;
const MAX_SUMMARY_CHARS = 8_000;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface SidecarLocalAnswer {
  id: string;
  /** Chat the decline happened in, captured when consent was REQUESTED. */
  chatKey: string;
  /** ISO timestamp of the decline. */
  deniedAt: string;
  /** What was asked locally. */
  query: string;
  /** The on-device answer itself. */
  summary: string;
  /** Local model that produced it, for user-facing transparency. */
  summaryModel?: string;
  /** Subject/sender lines of the matches the answer is based on. */
  hitLines: string[];
}

function isEntry(value: unknown): value is SidecarLocalAnswer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.chatKey === "string" &&
    typeof entry.deniedAt === "string" &&
    typeof entry.query === "string" &&
    typeof entry.summary === "string" &&
    Array.isArray(entry.hitLines)
  );
}

/**
 * Stored entries, minus anything expired and minus sentinel-keyed entries: a
 * brand-new chat's key cannot be re-attached after a reload, and guessing
 * would misfile someone else's answer under an unrelated chat.
 */
export function parseSidecarLocalAnswers(
  value: unknown,
  nowMs: number = Date.now(),
): SidecarLocalAnswer[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(
    (entry): entry is SidecarLocalAnswer =>
      isEntry(entry) &&
      entry.chatKey !== NEW_CHAT_LOCAL_ANSWER_KEY &&
      nowMs - Date.parse(entry.deniedAt) < TTL_MS,
  );
}

export const sidecarLocalAnswersPersistedOptions = {
  parse: (value: unknown) => parseSidecarLocalAnswers(value),
};

/**
 * Add an answer, replacing an earlier one for the same chat and query (a
 * retried search that is declined again must not stack), then enforce the
 * per-chat and total caps by dropping the oldest.
 */
export function addSidecarLocalAnswer(
  entries: readonly SidecarLocalAnswer[],
  entry: SidecarLocalAnswer,
): SidecarLocalAnswer[] {
  if (entry.summary.trim() === "") {
    return [...entries];
  }
  const capped: SidecarLocalAnswer = {
    ...entry,
    summary: entry.summary.slice(0, MAX_SUMMARY_CHARS),
  };
  const withoutDuplicate = entries.filter(
    (existing) =>
      !(existing.chatKey === capped.chatKey && existing.query === capped.query),
  );
  const next = [...withoutDuplicate, capped];
  const perChat = next.filter(
    (existing) => existing.chatKey === capped.chatKey,
  );
  const dropped = new Set(
    perChat
      .slice(0, Math.max(0, perChat.length - MAX_PER_CHAT))
      .map((e) => e.id),
  );
  const withinChatCap = next.filter((existing) => !dropped.has(existing.id));
  return withinChatCap.slice(Math.max(0, withinChatCap.length - MAX_TOTAL));
}

export function dismissSidecarLocalAnswer(
  entries: readonly SidecarLocalAnswer[],
  id: string,
): SidecarLocalAnswer[] {
  return entries.filter((entry) => entry.id !== id);
}

/**
 * Drop the entry for a chat+query pair. Called when the user later ALLOWS the
 * same search: the data graduated into the transcript, and two surfaces
 * showing the same answer with different provenance would be confusing.
 */
export function removeMatchingSidecarLocalAnswer(
  entries: readonly SidecarLocalAnswer[],
  chatKey: string,
  query: string,
): SidecarLocalAnswer[] {
  return entries.filter(
    (entry) => !(entry.chatKey === chatKey && entry.query === query),
  );
}

/** Move a brand-new chat's entries onto its real id once the server assigns one. */
export function rekeySidecarLocalAnswers(
  entries: readonly SidecarLocalAnswer[],
  realChatId: string,
): SidecarLocalAnswer[] {
  return entries.map((entry) =>
    entry.chatKey === NEW_CHAT_LOCAL_ANSWER_KEY
      ? { ...entry, chatKey: realChatId }
      : entry,
  );
}

export function sidecarLocalAnswersForChat(
  entries: readonly SidecarLocalAnswer[],
  chatKey: string | null | undefined,
): SidecarLocalAnswer[] {
  if (chatKey == null) {
    return [];
  }
  return entries.filter((entry) => entry.chatKey === chatKey).reverse();
}
