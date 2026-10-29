import { withWordTimeout } from "./wordTimeout";
import { wordWriteHost } from "./wordWriteHost";

export type WordChangeKind = "added" | "changed" | "deleted" | "unknown";
/** own: the pane's own writes; local: the user here, or on the web a desktop co-author (Word for
 * the web reports those as Local); remote: a co-author as Word reports it. */
export type WordChangeSource = "own" | "local" | "remote" | "unknown";
export type WordUnknownChange =
  | "no-events"
  | "return-to-pane"
  | "tracking-mode"
  | "no-ids"
  | "ids-replaced"
  | "other-journal"
  | "out-of-range"
  | "no-location"
  | "no-capture";

export interface WordChangeEntry {
  seq: number;
  at: number;
  kind: WordChangeKind;
  source: WordChangeSource;
  ids: readonly string[];
  reason?: WordUnknownChange;
  /** Per added id: the ids of its live neighbours, previous ones nearest first, then next ones;
   * null when Word could not tell them. An id that has no key here was not looked up. */
  location?: Map<string, readonly string[] | null>;
}

export interface WordChangePosition {
  journal: string;
  seq: number;
  /** Paragraph events were reaching the journal when the position was taken. */
  events: boolean;
}

export type WordChangesSince =
  | { ok: true; entries: readonly WordChangeEntry[] }
  | { ok: false; reason: "no-events" | "other-journal" | "out-of-range" };

export type WordOwnWriteKind = "ids" | "anchor" | "import";

export interface WordOwnWrite {
  end(): void;
}

/** ERMAIN-1005 F1: Word reports a pane write 0.5–1.7 s after its final sync (in-place Apply,
 * insertText; Word PC and the web). */
const OWN_TAIL_MS = 3_000;
/** An import's Added and Deleted for every paragraph kept coming for 15.3 s after Apply resolved
 * on a 1,654-block document, without pauses. */
const IMPORT_QUIET_MS = 2_000;
const IMPORT_CAP_MS = 30_000;
const MAX_ENTRIES = 1_000;
const NEIGHBOUR_STEPS = 8;
const NEIGHBOUR_BURST_MS = 100;
const NEIGHBOUR_BURST_IDS = 50;
const NEIGHBOUR_TIMEOUT_MS = 1_000;

interface OpenWrite {
  kind: WordOwnWriteKind;
  ids: Set<string>;
  begin: number;
  end?: number;
  lastEvent: number;
}

let journal = globalThis.crypto.randomUUID();
let seq = 0;
let dropped = 0;
/** Own events after this seq merge into the entry before them; a position taken since must not
 * see an entry grow behind it. */
let sealed = 0;
let entries: WordChangeEntry[] = [];
let eventsActive = false;
let captured = new Set<string>();
let writes: OpenWrite[] = [];
let lastOwnWrite: OpenWrite | undefined;
let pendingNeighbours = new Map<string, WordChangeEntry>();
let neighbourTimer: ReturnType<typeof setTimeout> | undefined;

export function noteWordChangeEventsActive(): void {
  eventsActive = true;
}

export function wordChangeEventsActive(): boolean {
  return eventsActive;
}

/** Taken before a capture reads the paragraphs, so an edit during the read counts as after it. */
export function wordChangePosition(): WordChangePosition {
  sealed = seq;
  return { journal, seq, events: eventsActive };
}

export function wordChangesSince(
  position: WordChangePosition,
): WordChangesSince {
  if (position.journal !== journal)
    return { ok: false, reason: "other-journal" };
  if (!position.events || !eventsActive)
    return { ok: false, reason: "no-events" };
  if (position.seq < dropped || position.seq > seq)
    return { ok: false, reason: "out-of-range" };
  return { ok: true, entries: entries.filter((e) => e.seq > position.seq) };
}

/** The paragraph ids of the latest capture, to tell a replacement of all of them. */
export function noteWordCapturedIds(ids: Iterable<string | null>): void {
  captured = new Set([...ids].filter((id): id is string => !!id));
}

export function recordWordUnknownChange(reason: WordUnknownChange): void {
  append({ kind: "unknown", source: "unknown", ids: [], reason });
}

/**
 * Registers a write of the pane's own, from before its first write to after its final sync, so
 * the Local events it causes count as own: "ids" claims events naming only the ids it names,
 * "anchor" (an insert at the selection, a comment) and "import" every Local event, an import until
 * Word goes quiet. A user's edit that lands inside such a window counts as own too.
 */
export function beginWordOwnWrite(kind: WordOwnWriteKind): WordOwnWrite {
  const now = Date.now();
  prune(now);
  const write: OpenWrite = { kind, ids: new Set(), begin: now, lastEvent: now };
  writes.push(write);
  return {
    end() {
      if (write.end !== undefined) return;
      write.end = Date.now();
      write.lastEvent = Math.max(write.lastEvent, write.end);
    },
  };
}

/** Names paragraphs the open writes change, delete or create. */
export function nameWordOwnWriteIds(
  ids: Iterable<string | null | undefined>,
): void {
  const named = [...ids].filter((id): id is string => !!id);
  for (const write of writes)
    if (write.end === undefined) for (const id of named) write.ids.add(id);
}

/** The open writes replace the whole document. */
export function markWordOwnImport(): void {
  for (const write of writes)
    if (write.end === undefined) write.kind = "import";
}

export interface WordParagraphEvent {
  type?: string;
  source?: string;
  uniqueLocalIds?: readonly string[];
}

export function recordWordParagraphEvent(event?: WordParagraphEvent): void {
  const now = Date.now();
  const ids = (event?.uniqueLocalIds ?? []).filter(
    (id): id is string => typeof id === "string" && !!id,
  );
  const kind: WordChangeKind =
    event?.type === "ParagraphAdded"
      ? "added"
      : event?.type === "ParagraphDeleted"
        ? "deleted"
        : "changed";
  const owner =
    event?.source === "Remote"
      ? undefined
      : writes.find((write) => owns(write, now, ids));
  if (owner) {
    owner.lastEvent = now;
    const last = entries.at(-1);
    if (
      last &&
      last.seq > sealed &&
      last.source === "own" &&
      last.kind === kind &&
      lastOwnWrite === owner
    ) {
      last.ids = [...last.ids, ...ids];
      return;
    }
    lastOwnWrite = owner;
    append({ kind, source: "own", ids });
    return;
  }
  prune(now);
  // Word for the web gave every paragraph a new id once a desktop co-author joined: one Deleted
  // naming all of them and no Added.
  if (kind === "deleted" && replacesCapture(ids)) {
    recordWordUnknownChange("ids-replaced");
    return;
  }
  const entry = append({
    kind,
    source: event?.source === "Remote" ? "remote" : "local",
    ids,
  });
  if (kind === "added") queueNeighbours(entry);
}

function owns(write: OpenWrite, now: number, ids: readonly string[]): boolean {
  if (now < write.begin) return false;
  if (write.kind === "import")
    return (
      write.end === undefined ||
      now <= write.end + OWN_TAIL_MS ||
      (now <= write.end + IMPORT_CAP_MS &&
        now - write.lastEvent <= IMPORT_QUIET_MS)
    );
  if (write.end !== undefined && now > write.end + OWN_TAIL_MS) return false;
  return (
    write.kind === "anchor" ||
    (ids.length > 0 && ids.every((id) => write.ids.has(id)))
  );
}

function prune(now: number): void {
  writes = writes.filter(
    (write) =>
      write.end === undefined ||
      now <=
        write.end + (write.kind === "import" ? IMPORT_CAP_MS : OWN_TAIL_MS),
  );
}

function replacesCapture(ids: readonly string[]): boolean {
  if (!captured.size) return false;
  let hits = 0;
  for (const id of ids) if (captured.has(id)) hits += 1;
  return hits * 2 >= captured.size;
}

function append(entry: Omit<WordChangeEntry, "seq" | "at">): WordChangeEntry {
  seq += 1;
  const full: WordChangeEntry = { ...entry, seq, at: Date.now() };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) {
    const removed = entries.splice(0, entries.length - MAX_ENTRIES);
    dropped = removed.at(-1)!.seq;
  }
  return full;
}

function queueNeighbours(entry: WordChangeEntry): void {
  if (!entry.ids.length) return;
  entry.location = new Map();
  for (const id of entry.ids) pendingNeighbours.set(id, entry);
  clearTimeout(neighbourTimer);
  neighbourTimer = setTimeout(() => {
    void resolveNeighbours();
  }, NEIGHBOUR_BURST_MS);
}

/** One Word.run per burst of added paragraphs: each walks back to a paragraph the latest capture
 * has, then forward, at most eight steps each way. A larger burst is left unresolved. */
async function resolveNeighbours(): Promise<void> {
  const batch = [...pendingNeighbours];
  pendingNeighbours = new Map();
  const settle = (found?: Map<string, string[]>) => {
    for (const [id, entry] of batch)
      entry.location?.set(id, found?.get(id) ?? null);
  };
  const word = wordWriteHost();
  if (!word || batch.length > NEIGHBOUR_BURST_IDS) return settle();
  try {
    const found = await withWordTimeout(
      word.run(async (context) => {
        const result = new Map<string, string[]>();
        const walk = async (
          step: (p: Word.Paragraph) => Word.Paragraph,
          from: Map<string, Word.Paragraph>,
        ) => {
          let active = from;
          for (let k = 0; k < NEIGHBOUR_STEPS && active.size; k++) {
            const next = new Map<string, Word.Paragraph>();
            for (const [id, paragraph] of active) {
              const neighbour = step(paragraph);
              neighbour.load("isNullObject,uniqueLocalId");
              next.set(id, neighbour);
            }
            await context.sync();
            active = new Map();
            for (const [id, neighbour] of next) {
              if (neighbour.isNullObject || !neighbour.uniqueLocalId) continue;
              result.get(id)!.push(neighbour.uniqueLocalId);
              if (!captured.has(neighbour.uniqueLocalId))
                active.set(id, neighbour);
            }
          }
        };
        const start = new Map(
          batch.map(([id]) => {
            result.set(id, []);
            return [id, context.document.getParagraphByUniqueLocalId(id)];
          }),
        );
        await walk((p) => p.getPreviousOrNullObject(), start);
        const unplaced = new Map(
          [...start].filter(
            ([id]) => !result.get(id)!.some((n) => captured.has(n)),
          ),
        );
        await walk((p) => p.getNextOrNullObject(), unplaced);
        return result;
      }),
      NEIGHBOUR_TIMEOUT_MS,
      () => new Error("neighbour read timed out"),
    );
    settle(found);
  } catch {
    settle();
  }
}

export function resetWordChangeJournalForTests(): void {
  journal = globalThis.crypto.randomUUID();
  seq = 0;
  dropped = 0;
  sealed = 0;
  entries = [];
  eventsActive = false;
  captured = new Set();
  writes = [];
  lastOwnWrite = undefined;
  pendingNeighbours = new Map();
  clearTimeout(neighbourTimer);
  neighbourTimer = undefined;
}
