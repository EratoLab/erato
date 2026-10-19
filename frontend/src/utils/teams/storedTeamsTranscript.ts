/**
 * A stored Teams transcript, fetched and parsed at most once per session.
 *
 * The index block stays in the file (ERMAIN-586), so every surface showing a
 * stored transcript reads it from there: the cards on a message and the
 * conversation preview behind them. Sharing the load means opening a card
 * never downloads the transcript again, and both render the same parse.
 */

import { parseTeamsTranscriptIndex } from "./teamsTranscriptIndex";

import type { TeamsTranscriptIndex } from "./teamsTranscriptIndex";

export type StoredTeamsTranscript =
  | { kind: "conversation"; index: TeamsTranscriptIndex }
  /** Readable, but carrying no block this build understands. */
  | { kind: "markdown"; text: string };

export type StoredTeamsTranscriptOutcome =
  | StoredTeamsTranscript
  | { kind: "unreachable" };

const LOADS = new Map<string, Promise<StoredTeamsTranscript>>();
const SETTLED = new Map<string, StoredTeamsTranscriptOutcome>();

/** A citation's `#msg=` anchor names a message, not another file. */
function cacheKey(url: string): string {
  return url.split("#", 1)[0];
}

/**
 * Rejects when the file cannot be fetched. The failure is remembered for
 * `peek` but not for the next load, so reopening the preview retries.
 */
export function loadStoredTeamsTranscript(
  url: string,
): Promise<StoredTeamsTranscript> {
  const key = cacheKey(url);
  const pending = LOADS.get(key);
  if (pending) return pending;

  const load = fetchTranscript(key);
  LOADS.set(key, load);
  load.then(
    (stored) => SETTLED.set(key, stored),
    () => {
      LOADS.delete(key);
      SETTLED.set(key, { kind: "unreachable" });
    },
  );
  return load;
}

/** What an earlier load settled on, without starting one. */
export function peekStoredTeamsTranscript(
  url: string,
): StoredTeamsTranscriptOutcome | undefined {
  return SETTLED.get(cacheKey(url));
}

/** Test seam: each suite stubs `fetch` afresh. */
export function forgetStoredTeamsTranscripts() {
  LOADS.clear();
  SETTLED.clear();
}

async function fetchTranscript(url: string): Promise<StoredTeamsTranscript> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const index = parseTeamsTranscriptIndex(text);
  return index ? { kind: "conversation", index } : { kind: "markdown", text };
}
