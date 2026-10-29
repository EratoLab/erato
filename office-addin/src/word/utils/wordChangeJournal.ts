import { withWordTimeout } from "./wordTimeout";
import { wordWriteHost } from "./wordWriteHost";

export type WordChangeKind = "added" | "changed" | "deleted" | "unknown";
/** own: the pane's own writes; local: the user here, or on the web a desktop co-author (Word for
 * the web reports those as Local); remote: a co-author as Word reports it. */
export type WordChangeSource = "own" | "local" | "remote" | "unknown";
/** A change the journal knows happened but not where. */
export type WordUnknownChange = "tracking-mode" | "ids-replaced";

export interface WordChangeEntry {
  seq: number;
  at: number;
  kind: WordChangeKind;
  source: WordChangeSource;
  ids: readonly string[];
  /** Ids named beyond the first 64 an entry keeps; no read can place them. */
  moreIds?: number;
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
/** For events naming only paragraphs the write named: Word PC reported an in-place Revert's
 * Changed more than 3 s after the Revert ended (ERMAIN-1010 gate, 1 of 7). A user's edit to that
 * same paragraph within these 6 s counts as own too. */
const NAMED_TAIL_MS = 6_000;
/** Word PC sent a 1,654-block import's Added and Deleted, one id each, until 58.5 s after Apply
 * resolved, with pauses of up to 5.6 s and the Deleted of the old paragraphs last (ERMAIN-1010
 * gate). Word for Mac sent them all within 2.4 s. */
const IMPORT_CAP_MS = 120_000;
const IMPORT_QUIET_MS = 2_000;
/** A write still open this long after it began counts as ended then, so a Word.run that settles
 * late or never cannot claim the user's later edits. The slowest F1 Apply took 6.4 s. */
const OPEN_WRITE_CAP_MS = 60_000;
/** A local or remote event of the kind and source of one this recent joins its entry, so a burst
 * of one-id events cannot push older positions out of the journal. */
const MERGE_BURST_MS = 250;
const MERGE_MAX_IDS = 64;
const MAX_ENTRIES = 1_000;
const NEIGHBOUR_STEPS = 8;
const NEIGHBOUR_BURST_MS = 100;
const NEIGHBOUR_BURST_IDS = 50;
const NEIGHBOUR_TIMEOUT_MS = 1_000;

type MergedEntry = WordChangeEntry & { ids: string[] };

interface OpenWrite {
  kind: WordOwnWriteKind;
  ids: Set<string>;
  begin: number;
  /** When an anchor or import write starts claiming Local events by kind: at its write, not
   * before the checks that may refuse it. */
  from: number;
  end?: number;
  lastEvent: number;
  /** An import's: the paragraphs live when it began whose Deleted Word has not sent yet. */
  replaced: Set<string>;
  /** Its own entry per kind; merging keeps an import's burst from evicting older positions. */
  entries: Partial<Record<WordChangeKind, MergedEntry>>;
}

let journal = globalThis.crypto.randomUUID();
let seq = 0;
let dropped = 0;
/** Events after this seq merge into the entry before them; a position taken since must not see
 * an entry grow behind it. */
let sealed = 0;
let entries: WordChangeEntry[] = [];
let eventsActive = false;
let captured = new Set<string>();
/** The latest capture's ids, plus those added since, less those deleted. */
let live = new Set<string>();
let bursts = new Map<string, { entry: MergedEntry; at: number }>();
let writes: OpenWrite[] = [];
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
  live = new Set(captured);
}

export function recordWordUnknownChange(reason: WordUnknownChange): void {
  append({ kind: "unknown", source: "unknown", ids: [], reason });
}

/**
 * Registers a write of the pane's own, from before its first write to after its final sync, so
 * the Local events it causes count as own: "ids" claims events naming only the ids it names,
 * "anchor" (an insert at the selection, a comment) every Local event, and "import" every Local
 * Added and Deleted until Word has reported the paragraphs from before it deleted and gone quiet.
 * A user's edit that lands inside such a window counts as own too.
 */
export function beginWordOwnWrite(kind: WordOwnWriteKind): WordOwnWrite {
  const now = Date.now();
  prune(now);
  const write: OpenWrite = {
    kind,
    ids: new Set(),
    begin: now,
    from: now,
    lastEvent: now,
    replaced: new Set(kind === "import" ? live : []),
    entries: {},
  };
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

/** The open writes replace the whole document, from now. */
export function markWordOwnImport(): void {
  const now = Date.now();
  for (const write of writes)
    if (write.end === undefined && write.kind !== "import") {
      write.kind = "import";
      write.from = now;
      write.replaced = new Set(live);
    }
}

/** The open writes now create paragraphs whose ids no one knows before Word reports them. */
export function markWordOwnAnchor(): void {
  const now = Date.now();
  for (const write of writes)
    if (write.end === undefined && write.kind === "ids") {
      write.kind = "anchor";
      write.from = now;
    }
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
  const source = event?.source === "Remote" ? "remote" : "local";
  if (kind === "deleted") forgetPendingNeighbours(ids);
  const owners =
    source === "remote"
      ? []
      : writes.filter((write) => owns(write, now, kind, ids));
  noteLive(kind, ids);
  const owner = owners[0];
  if (owner) {
    for (const write of owners) write.lastEvent = now;
    const open = owner.entries[kind];
    if (!open || !merge(open, ids))
      owner.entries[kind] = record(kind, "own", ids);
    return;
  }
  prune(now);
  // Word for the web gave every paragraph a new id once a desktop co-author joined: one Deleted
  // naming all of them and no Added.
  if (kind === "deleted" && replacesCapture(ids)) {
    recordWordUnknownChange("ids-replaced");
    return;
  }
  const key = `${kind}:${source}`;
  const burst = bursts.get(key);
  let entry: MergedEntry;
  if (burst && now - burst.at <= MERGE_BURST_MS && merge(burst.entry, ids)) {
    burst.at = now;
    entry = burst.entry;
  } else {
    entry = record(kind, source, ids);
    bursts.set(key, { entry, at: now });
  }
  if (kind === "added") queueNeighbours(entry);
}

function noteLive(kind: WordChangeKind, ids: readonly string[]): void {
  if (kind === "added") for (const id of ids) live.add(id);
  if (kind !== "deleted") return;
  for (const id of ids) {
    live.delete(id);
    for (const write of writes) write.replaced.delete(id);
  }
}

function endOf(write: OpenWrite, now: number): number | undefined {
  const cap = write.begin + OPEN_WRITE_CAP_MS;
  return write.end ?? (now > cap ? cap : undefined);
}

function owns(
  write: OpenWrite,
  now: number,
  kind: WordChangeKind,
  ids: readonly string[],
): boolean {
  if (now < write.begin) return false;
  const end = endOf(write, now);
  const within = (tail: number) => end === undefined || now <= end + tail;
  if (
    write.kind === "import" &&
    now >= write.from &&
    kind !== "changed" &&
    importOpen(write, now, end)
  )
    return true;
  if (write.kind === "anchor" && now >= write.from && within(OWN_TAIL_MS))
    return true;
  return (
    ids.length > 0 &&
    ids.every((id) => write.ids.has(id)) &&
    within(NAMED_TAIL_MS)
  );
}

/** Word sends no Changed for an import (Word PC and Mac), only Added and Deleted. */
function importOpen(
  write: OpenWrite,
  now: number,
  end: number | undefined,
): boolean {
  if (end === undefined || now <= end + OWN_TAIL_MS) return true;
  // Word PC reports an import from a few milliseconds after it ends, Word for Mac before then: an
  // import with no event after it ended by now changed nothing (refused at its sync) or is over.
  if (now > end + IMPORT_CAP_MS || write.lastEvent <= end) return false;
  return write.replaced.size > 0 || now - write.lastEvent <= IMPORT_QUIET_MS;
}

function prune(now: number): void {
  writes = writes.filter((write) => {
    const end = endOf(write, now);
    return (
      end === undefined ||
      now <= end + (write.kind === "import" ? IMPORT_CAP_MS : NAMED_TAIL_MS)
    );
  });
}

function replacesCapture(ids: readonly string[]): boolean {
  if (!captured.size) return false;
  let hits = 0;
  for (const id of ids) if (captured.has(id)) hits += 1;
  return hits * 2 >= captured.size;
}

/** Adds ids to an entry no position was taken after; ids beyond the first 64 are only counted. */
function merge(entry: MergedEntry, ids: readonly string[]): boolean {
  if (entry.seq <= sealed) return false;
  for (const id of ids) {
    if (entry.ids.includes(id)) continue;
    if (entry.ids.length < MERGE_MAX_IDS) entry.ids.push(id);
    else entry.moreIds = (entry.moreIds ?? 0) + 1;
  }
  return true;
}

function record(
  kind: WordChangeKind,
  source: WordChangeSource,
  ids: readonly string[],
): MergedEntry {
  const entry = append({ kind, source, ids: [] as string[] });
  merge(entry, ids);
  return entry;
}

function append<T extends Omit<WordChangeEntry, "seq" | "at">>(
  entry: T,
): T & WordChangeEntry {
  seq += 1;
  const full = { ...entry, seq, at: Date.now() };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) {
    const removed = entries.splice(0, entries.length - MAX_ENTRIES);
    dropped = removed.at(-1)!.seq;
  }
  return full;
}

/** A paragraph deleted before its neighbours are read would fail the whole burst's read. */
function forgetPendingNeighbours(ids: readonly string[]): void {
  for (const id of ids) {
    const entry = pendingNeighbours.get(id);
    if (!entry) continue;
    pendingNeighbours.delete(id);
    entry.location?.set(id, null);
  }
}

function queueNeighbours(entry: WordChangeEntry): void {
  if (!entry.ids.length) return;
  entry.location ??= new Map();
  for (const id of entry.ids)
    if (!entry.location.has(id)) pendingNeighbours.set(id, entry);
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
  live = new Set();
  bursts = new Map();
  writes = [];
  pendingNeighbours = new Map();
  clearTimeout(neighbourTimer);
  neighbourTimer = undefined;
}
