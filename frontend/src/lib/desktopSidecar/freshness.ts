/* eslint-disable lingui/no-unlocalized-strings -- Model-facing protocol values. */
import { outlookMailboxId } from "./mailboxAccess";

import type { SearchQueryV1Result } from "@erato/desktop-sidecar-protocol";

/**
 * What a thread or document read covered, for an approval that may outlast
 * the read (ERMAIN-1033). `position` and `added` stay "unknown" until the
 * sidecar reports an index position and the items added to a thread since
 * one; "unknown" anywhere must read as a change.
 */
export interface SidecarScopeSignal {
  kind: "thread" | "document";
  /** `<namespace>:<value>` of what the read returned, never of its anchor. */
  id: string;
  position: string;
  added: number | "unknown";
}

export interface SidecarFreshness {
  readAt: string;
  changes: "none" | "unknown";
  /** The index keeps no change journal; `changes` carries its blindness. */
  counts: { own: 0; local: 0; remote: 0; unknown: 0 };
  scope?: SidecarScopeSignal;
}

/** What a search hit says about where its document lives, as the index
 * groups a thread: same source, same mailbox, same conversation key. */
export interface HitThread {
  /** The hit's document kind: only an email export widens to its thread. */
  kind: string;
  sourceId?: string;
  mailboxId: string | null;
  conversationKey: string | null;
}

const UNKNOWN = "unknown";

export function sidecarFreshness(
  readAt: number,
  changes: SidecarFreshness["changes"] = UNKNOWN,
  scope?: SidecarScopeSignal,
): SidecarFreshness {
  return {
    readAt: new Date(readAt).toISOString(),
    changes,
    counts: { own: 0, local: 0, remote: 0, unknown: 0 },
    ...(scope ? { scope } : {}),
  };
}

/**
 * "none" only when every searched source is available, has nothing newer
 * queued and was observed no earlier than the read began. The index is not
 * live, so anything less, or a value it does not report, is "unknown".
 */
export function searchChanges(
  coverage: SearchQueryV1Result["coverage"],
  readAt: number,
): SidecarFreshness["changes"] {
  if (!coverage?.sources.length) return UNKNOWN;
  const caughtUp = coverage.sources.every((source) => {
    const observed =
      source.observedAt === null ? NaN : Date.parse(source.observedAt);
    return (
      source.unavailableReason === null &&
      source.through === null &&
      source.pendingNewer === 0 &&
      !Number.isNaN(observed) &&
      observed >= readAt
    );
  });
  return caughtUp ? "none" : UNKNOWN;
}

async function sha256Hex(text: string): Promise<string | undefined> {
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    // Outside a secure context there is no digest, and no id is better than
    // a guessed one.
    return undefined;
  }
}

const scope = (
  kind: SidecarScopeSignal["kind"],
  id: string | undefined,
): SidecarScopeSignal => ({
  kind,
  id: id ?? UNKNOWN,
  position: UNKNOWN,
  added: UNKNOWN,
});

/**
 * A document export covers the document alone, or an email's thread as the
 * index groups it. The export reports no thread key, so the thread comes from
 * the search hit this client saw for the document. A file's export never
 * widens, and a Teams message's covers a part of its chat the index names by
 * no key, so its id stays unknown.
 */
export async function documentScope(
  documentId: string,
  subjectScope: string | undefined,
  hit: HitThread | undefined,
): Promise<SidecarScopeSignal> {
  if (subjectScope !== "subject_with_thread" || hit?.kind === "file")
    return scope("document", `doc:${documentId.toLowerCase()}`);
  if (hit?.kind !== "email" || !hit.conversationKey)
    return scope("thread", undefined);
  const digest = await sha256Hex(
    JSON.stringify([
      hit.sourceId ?? null,
      hit.mailboxId ?? null,
      hit.conversationKey,
    ]),
  );
  return scope("thread", digest && `index-thread:${digest}`);
}

/** Bytes 6..22 of a conversation index: the GUID that groups the thread,
 * after the reserved byte and the five-byte time. */
const threadGuid = (conversationIndex: string | null | undefined) =>
  conversationIndex && /^[0-9a-f]{44,}$/i.test(conversationIndex)
    ? conversationIndex.slice(12, 44).toLowerCase()
    : undefined;

/** The thread every returned message names, or "unknown" when none does or
 * they disagree. */
export async function conversationScope(
  mailboxId: string,
  messages: readonly { conversationIndex?: string | null }[],
): Promise<SidecarScopeSignal> {
  const guids = new Set(
    messages.flatMap((message) => {
      const guid = threadGuid(message.conversationIndex);
      return guid ? [guid] : [];
    }),
  );
  if (guids.size !== 1) return scope("thread", undefined);
  const [guid] = [...guids];
  let mailbox: string;
  try {
    mailbox = outlookMailboxId(mailboxId);
  } catch {
    return scope("thread", undefined);
  }
  const digest = await sha256Hex(JSON.stringify([mailbox, guid]));
  return scope("thread", digest && `outlook-thread:${digest}`);
}
