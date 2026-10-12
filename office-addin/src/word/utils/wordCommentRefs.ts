import {
  isWordCommentEntryRef,
  isWordCommentThreadRef,
} from "@erato/frontend/word-review";

import { wordCommentAnchorText } from "./wordCommentPackage";

import type {
  WordCommentEntryRecord,
  WordCommentThreadRecord,
} from "./wordCommentReader";

/**
 * Session refs for comment threads (contract §4): "t" and two or three base-36 characters, a name
 * that says nothing about position or age. A modern file's ref comes from String(Comment.id), so a
 * rebuild after a pane teardown (#6958) or a reload gives the same refs. A legacy file's ids change
 * on every open (F-2a), so its refs come from author, time, content and quote instead (O-17).
 * Within a pane session a ref sticks to its thread and never names another, even after a delete.
 * The model only ever sees refs; Comment.id and the fingerprints stay in pane memory.
 */

const REF_SPACE = 36 ** 3;
/** Past this many salted tries the next free ref is taken in turn. */
const REF_TRIES = 256;
/** "t12" reads like a number, which the model could take for an order. */
const DIGITS_ONLY = /^t\d+$/;

export interface WordCommentFingerprintAnchor {
  para: number | null;
  through?: number;
  /** From Comment.getRange().text, so every read gives the same quote. */
  quote: string;
}

export interface WordCommentEntryFingerprint {
  id: string;
  author: string;
  /** creationDate.toISOString(); null when Word gave none. */
  created: string | null;
  content: string;
}

/** What a write proves unchanged before it touches a thread (contract §4.4); pane memory only. */
export interface WordCommentFingerprint extends WordCommentEntryFingerprint {
  resolved: boolean;
  /** In Word's order; null when the replies were not read. */
  replyIds: readonly string[] | null;
  replies: readonly WordCommentEntryFingerprint[] | null;
  anchor: WordCommentFingerprintAnchor | null;
}

export interface WordCommentRefEntry {
  ref: string;
  /** String(Comment.id); repeated ids (F-19) keep theirs, so a write finds both and refuses. */
  commentId: string;
  /** "content": a legacy file, whose ref names the thread by its content (the card says so). */
  matchedBy: "id" | "content";
  fingerprint: WordCommentFingerprint;
}

/** The refs frozen with the Send capture; actions resolve refs against these only. */
export interface WordCommentCaptureRefs {
  identity: string;
  legacy: boolean | null;
  /** One per thread read, in the order read (document order). */
  threads: readonly WordCommentRefEntry[];
  byRef: ReadonlyMap<string, WordCommentRefEntry>;
}

export interface WordCommentRefRegistry {
  readonly identity: string;
  /** "id:<Comment.id>" and, in legacy files, "content:<…>" → ref; "#k" marks a k-th repeat. */
  readonly refs: Map<string, string>;
  /** Every ref issued in this pane session, with the key it was issued for. */
  readonly issued: Map<string, string>;
  /** The latest fingerprint per ref. */
  readonly fingerprints: Map<string, WordCommentFingerprint>;
}

export type WordCommentRefResolution =
  | { ok: true; entry: WordCommentRefEntry; target: { kind: "thread" } }
  | {
      ok: true;
      entry: WordCommentRefEntry;
      /** n is 0 for the thread's comment, 1 onwards for its replies in Word's order. */
      target: { kind: "entry"; n: number; commentId: string };
    }
  | { ok: false; code: "unknown-ref" };

export function createWordCommentRefRegistry(
  identity: string,
): WordCommentRefRegistry {
  return {
    identity,
    refs: new Map(),
    issued: new Map(),
    fingerprints: new Map(),
  };
}

const registries = new Map<string, WordCommentRefRegistry>();

/** The pane session's registry for one document. */
export function wordCommentRefRegistry(
  identity: string,
): WordCommentRefRegistry {
  let registry = registries.get(identity);
  if (!registry) {
    registry = createWordCommentRefRegistry(identity);
    registries.set(identity, registry);
  }
  return registry;
}

/** What a pane teardown or reload does: every ref is forgotten and comes back by derivation. */
export function forgetWordCommentRefs(): void {
  registries.clear();
}

/** cyrb53: a 53-bit string hash, so refs spread evenly over the ref space. */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const refOfNumber = (n: number) => `t${n.toString(36).padStart(2, "0")}`;

/** The ref a source derives to at a salt; a collision tries the next salt. */
export function wordCommentRefFor(source: string, salt = 0): string {
  return refOfNumber(hash53(source, salt) % REF_SPACE);
}

export const wordCommentEntryRef = (ref: string, n: number) => `${ref}.${n}`;

const normalizedContent = (text: string) => text.replace(/\r\n?/g, "\n");

const minuteOf = (date: Date | null) =>
  date ? date.toISOString().slice(0, 16) : "";

/** The anchored text as Comment.getRange() gives it, without marks: the same on every read. */
function rangeQuote(record: WordCommentThreadRecord): string {
  const rangeText = record.anchor?.rangeText ?? "";
  return wordCommentAnchorText({ kind: "unplaced", rangeText }).quote;
}

function entryPrint(
  entry: WordCommentEntryRecord,
): WordCommentEntryFingerprint {
  return {
    id: entry.id,
    author: entry.authorName,
    created: entry.creationDate?.toISOString() ?? null,
    content: entry.content,
  };
}

/** The fingerprint of a thread as read; a write reads it again and compares (contract §4.4). */
export function wordCommentFingerprint(
  record: WordCommentThreadRecord,
): WordCommentFingerprint {
  const anchor = record.anchor;
  const para = anchor?.first.ordinal ?? null;
  const last = anchor?.last.ordinal ?? null;
  return {
    ...entryPrint(record),
    resolved: record.resolved,
    replyIds: record.replies?.map((reply) => reply.id) ?? null,
    replies: record.replies?.map(entryPrint) ?? null,
    anchor: anchor
      ? {
          para,
          ...(para !== null && last !== null && last > para
            ? { through: last }
            : {}),
          quote: rangeQuote(record),
        }
      : null,
  };
}

/** A legacy thread's identity across opens: author, minute, content and quote (O-17). */
function contentSource(record: WordCommentThreadRecord): string {
  return [
    record.authorName,
    minuteOf(record.creationDate),
    normalizedContent(record.content),
    rangeQuote(record),
  ].join("\u001f");
}

interface Pending {
  index: number;
  source: string;
  keys: string[];
}

function issue(
  registry: WordCommentRefRegistry,
  source: string,
  key: string,
): string {
  for (let salt = 0; salt < REF_TRIES; salt += 1) {
    const ref = wordCommentRefFor(source, salt);
    if (!registry.issued.has(ref) && !DIGITS_ONLY.test(ref)) return ref;
  }
  const start = hash53(source, REF_TRIES) % REF_SPACE;
  for (let step = 0; step < REF_SPACE; step += 1) {
    const ref = refOfNumber((start + step) % REF_SPACE);
    if (!registry.issued.has(ref) && !DIGITS_ONLY.test(ref)) return ref;
  }
  throw new Error(`No free comment ref is left for ${key.slice(0, 3)}`);
}

/**
 * Refs for the threads of one read, in document order. A thread keeps the ref this session gave
 * it; new threads derive theirs in a fixed order of their sources, so neither Word's items order
 * nor the read order changes which of two colliding threads gets the unsalted ref.
 */
export function issueWordCommentRefs(
  registry: WordCommentRefRegistry,
  threads: readonly WordCommentThreadRecord[],
  legacy: boolean | null,
): WordCommentCaptureRefs {
  const byContent = legacy === true;
  const refs: (string | null)[] = threads.map(() => null);
  const used = new Set<string>();
  const seen = new Map<string, number>();
  const repeat = (key: string) => {
    const k = (seen.get(key) ?? 0) + 1;
    seen.set(key, k);
    return k === 1 ? key : `${key}#${k}`;
  };
  const pending: Pending[] = [];

  threads.forEach((record, index) => {
    const idKey = repeat(`id:${record.id}`);
    const source = byContent ? contentSource(record) : record.id;
    const contentKey = byContent ? repeat(`content:${source}`) : null;
    const keys = contentKey ? [idKey, contentKey] : [idKey];
    const known = keys
      .map((key) => registry.refs.get(key))
      .find((ref) => ref !== undefined && !used.has(ref));
    if (known) {
      refs[index] = known;
      used.add(known);
      for (const key of keys) registry.refs.set(key, known);
      return;
    }
    const occurrence = Number((contentKey ?? idKey).split("#")[1] ?? 1);
    pending.push({
      index,
      source: occurrence > 1 ? `${source}#${occurrence}` : source,
      keys,
    });
  });

  pending.sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : a.index - b.index,
  );
  for (const { index, source, keys } of pending) {
    const ref = issue(registry, source, keys[0]);
    registry.issued.set(ref, keys[keys.length - 1]);
    for (const key of keys) registry.refs.set(key, ref);
    refs[index] = ref;
  }

  const entries = threads.map((record, index): WordCommentRefEntry => {
    const ref = refs[index]!;
    const fingerprint = wordCommentFingerprint(record);
    registry.fingerprints.set(ref, fingerprint);
    return {
      ref,
      commentId: record.id,
      matchedBy: byContent ? "content" : "id",
      fingerprint,
    };
  });
  return {
    identity: registry.identity,
    legacy,
    threads: entries,
    byRef: new Map(entries.map((entry) => [entry.ref, entry])),
  };
}

/** "t7k" names the thread; "t7k.0" its comment, "t7k.2" its second reply. */
export function resolveWordCommentRef(
  refs: WordCommentCaptureRefs,
  value: unknown,
): WordCommentRefResolution {
  if (isWordCommentThreadRef(value)) {
    const entry = refs.byRef.get(value);
    return entry
      ? { ok: true, entry, target: { kind: "thread" } }
      : { ok: false, code: "unknown-ref" };
  }
  if (!isWordCommentEntryRef(value)) return { ok: false, code: "unknown-ref" };
  const [ref, part] = value.split(".");
  const entry = refs.byRef.get(ref);
  const n = Number(part);
  if (!entry) return { ok: false, code: "unknown-ref" };
  if (n === 0)
    return {
      ok: true,
      entry,
      target: { kind: "entry", n, commentId: entry.commentId },
    };
  const reply = entry.fingerprint.replies?.[n - 1];
  return reply
    ? { ok: true, entry, target: { kind: "entry", n, commentId: reply.id } }
    : { ok: false, code: "unknown-ref" };
}
