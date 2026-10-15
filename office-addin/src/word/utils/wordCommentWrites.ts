import { wordCommentEdgePiece } from "./wordCommentChanges";
import {
  noteWordCommentHostError,
  wordCommentErrorCode,
} from "./wordCommentPolicy";
import {
  wordCommentNewThreadRef,
  wordCommentRefRegistry,
} from "./wordCommentRefs";
import { wordHostPlatform } from "./wordHostPlatform";
import { resolveWordParagraphs } from "./wordParagraphResolver";
import { runWordGuarded } from "./wordRunGuard";
import {
  buildWordSelectionRanges,
  queueWordSearch,
  queueWordSearchHitProof,
  wordSearchable,
} from "./wordSelectionRange";
import { currentWordSelectionSupport } from "./wordSelectionSupport";
import { readWordStory } from "./wordSelectionTarget";

import type {
  WordCommentAddTarget,
  WordCommentDraft,
  WordCommentDraftRow,
} from "./wordCommentChanges";
import type { WordCommentEntryFingerprint } from "./wordCommentRefs";
import type { WordHostPlatform } from "./wordHostPlatform";
import type { WordSelectionRangeTarget } from "./wordSelectionRange";
import type { WordSelectionSupport } from "./wordSelectionSupport";
import type { WordStoryRead } from "./wordSelectionTarget";
import type {
  WordCommentAuthorMode,
  WordCommentOp,
  WordCommentRefusalCode,
  WordCommentRowStatus,
} from "@erato/frontend/word-review";

/**
 * Comment writes (contract §9.3, §9.7; Annex B §3): each row proves its target in the run that
 * writes it, and a fresh run reads every write back. Nothing is retried: a write that cannot be
 * confirmed stays unverified, so no comment is ever posted twice.
 */

const SEARCH_MAX = 255;
export const WORD_COMMENT_RUN_TIMEOUT_MS = 30_000;
/** Word for Mac added 50 comments in one sync in 13.3 s (P-PERF). */
export const WORD_COMMENT_RUN_MS_PER_ROW = 1_000;
/** Word for the web lists a write at once in the probes; a short poll covers a slow save. */
export const WORD_COMMENT_WEB_POLLS = 8;
export const WORD_COMMENT_WEB_POLL_MS = 500;

const COMMENT_FIELDS =
  "items/id,items/content,items/authorName,items/authorEmail,items/resolved,items/creationDate";
const REPLY_FIELDS =
  "items/id,items/content,items/authorName,items/authorEmail,items/creationDate";

export type WordCommentRevertStep =
  | {
      kind: "delete-comment";
      commentId: string;
      content: string;
      author: string;
    }
  | { kind: "delete-reply"; threadId: string; replyId: string; content: string }
  | { kind: "set-resolved"; threadId: string; from: boolean; to: boolean }
  | {
      kind: "restore-content";
      threadId: string;
      /** Null for the thread's comment itself. */
      replyId: string | null;
      previous: string;
      written: string;
    };

export interface WordCommentRowResult {
  i: number;
  op: WordCommentOp;
  ref?: string;
  status: WordCommentRowStatus;
  code?: WordCommentRefusalCode | string;
  /** String(id) of the comment or reply the row wrote or changed. */
  commentId?: string;
  newRef?: string;
  /** Adds: whom Word shows as the author now. */
  author?: WordCommentAuthorMode;
  /** Pane memory only; delete has none. */
  revert?: WordCommentRevertStep;
}

export interface WordCommentRun {
  rows: WordCommentRowResult[];
  /** Resolves once every Word run has ended, which after a timeout may be much later. */
  settled: Promise<void>;
  timedOut: boolean;
}

export interface WordCommentExecuteOptions {
  /** Rows the user kept ticked; the others end refused DESELECTED. */
  selected: ReadonlySet<number>;
  /** The AI author's name for adds the card offered under it; null posts all as the user. */
  assistantAuthor: string | null;
  /** Rows the card showed would post under the user's name. */
  userModeRows?: ReadonlySet<number>;
  host?: WordHostPlatform;
  pollMs?: number;
  /** O-28 re-attribution; injected so the write path stays testable on its own. */
  reattribute?: WordCommentReattribute;
}

/** Re-attributes verified labelled adds to the AI author; per row, the outcome it reached. */
export type WordCommentReattribute = (input: {
  draft: WordCommentDraft;
  rows: readonly { row: WordCommentDraftRow; commentId: string }[];
  authorName: string;
}) => Promise<{
  outcomes: Map<
    number,
    { status: "applied" | "applied_as_user" | "unverified"; code?: string }
  >;
  /** A rewrite that timed out may still land: the card holds every write until this resolves. */
  settled: Promise<void>;
  timedOut: boolean;
}>;

const SETTLED = Promise.resolve();

/** Desktop reads a written "\n" back as "\r" (P-EDIT). */
export const sameCommentText = (a: string, b: string) =>
  a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");

const sleep = (ms: number) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : SETTLED;

function timeoutFor(rows: number) {
  return WORD_COMMENT_RUN_TIMEOUT_MS + rows * WORD_COMMENT_RUN_MS_PER_ROW;
}

function refusalOf(error: unknown): WordCommentRefusalCode | string {
  const code = wordCommentErrorCode(error);
  if (code === "AccessDenied") return "DOCUMENT_READ_ONLY";
  if (
    code === "NotAllowed" ||
    code === "NotImplemented" ||
    code === "ApiNotFound"
  )
    return "HOST_NOT_ALLOWED";
  return code ?? "WRITE_FAILED";
}

export async function executeWordCommentDraft(
  draft: WordCommentDraft,
  options: WordCommentExecuteOptions,
): Promise<WordCommentRun> {
  const chosen = draft.rows.filter((row) => options.selected.has(row.i));
  const deselected: WordCommentRowResult[] = draft.rows
    .filter((row) => !options.selected.has(row.i))
    .map((row) => ({
      i: row.i,
      op: row.op,
      ...(row.ref ? { ref: row.ref } : {}),
      status: "refused",
      code: "DESELECTED",
    }));
  const run =
    chosen.length === 0
      ? { rows: [], settled: SETTLED, timedOut: false }
      : draft.action === "word.add_comments"
        ? await runAdds(draft, chosen, options)
        : draft.action === "word.respond_to_comments"
          ? await runResponds(draft, chosen, options)
          : await runModifies(draft, chosen, options);
  return {
    ...run,
    rows: [...run.rows, ...deselected].sort((a, b) => a.i - b.i),
  };
}

// ---------------------------------------------------------------- adds

interface ProvenAdd {
  row: WordCommentDraftRow;
  range: Word.Range;
  firstPosition: number;
  start: number;
}

type EdgePlan =
  | { kind: "content"; paragraph: Word.Paragraph }
  | {
      kind: "hit";
      target: WordSelectionRangeTarget;
      hits?: Word.RangeCollection;
    }
  | { kind: "points"; target: WordSelectionRangeTarget };

function edgeTarget(
  paragraph: Word.Paragraph,
  rangeText: string,
  start: number,
  end: number,
  support: WordSelectionSupport,
): EdgePlan | null {
  if (start === 0 && end === rangeText.length)
    return { kind: "content", paragraph };
  const target = { paragraph, rangeText, start, end };
  if (wordSearchable(rangeText.slice(start, end), SEARCH_MAX))
    return { kind: "hit", target };
  return support.prefixRanges ? { kind: "points", target } : null;
}

interface AddPlan {
  row: WordCommentDraftRow;
  add: WordCommentAddTarget;
  positions: number[];
  edges: EdgePlan[];
}

function planAdd(
  row: WordCommentDraftRow,
  story: WordStoryRead,
  support: WordSelectionSupport,
): AddPlan | WordCommentRefusalCode {
  const add = row.add!;
  const resolved = resolveWordParagraphs(add.anchor, story.entries);
  if ("refused" in resolved)
    return resolved.refused === "ambiguous"
      ? "AMBIGUOUS_TARGET"
      : "TARGET_TEXT_MISMATCH";
  const { positions } = resolved;
  if (
    positions.some(
      (position, k) => story.rangeTexts[position] !== add.rangeTexts[k],
    )
  )
    return "TARGET_TEXT_MISMATCH";
  const first = positions[0];
  const last = positions[positions.length - 1];
  const firstText = story.rangeTexts[first];
  const lastText = story.rangeTexts[last];
  if (positions.length === 1) {
    const edge = edgeTarget(
      story.items[first],
      firstText,
      add.start,
      add.end,
      support,
    );
    return edge
      ? { row, add, positions, edges: [edge] }
      : "TARGET_RANGE_UNPROVEN";
  }
  const head = wordCommentEdgePiece(
    firstText,
    add.start,
    firstText.length,
    "start",
  );
  const tail = wordCommentEdgePiece(lastText, 0, add.end, "end");
  if (!head || !tail) return "TARGET_RANGE_UNPROVEN";
  const startEdge =
    head.start === head.end
      ? ({ kind: "content", paragraph: story.items[first] } as const)
      : edgeTarget(
          story.items[first],
          firstText,
          head.start,
          head.end,
          support,
        );
  const endEdge =
    tail.start === tail.end
      ? ({ kind: "content", paragraph: story.items[last] } as const)
      : edgeTarget(story.items[last], lastText, tail.start, tail.end, support);
  if (!startEdge || !endEdge) return "TARGET_RANGE_UNPROVEN";
  return { row, add, positions, edges: [startEdge, endEdge] };
}

/** The proven range of one edge; null when Word's hits or points do not prove it. */
function settledEdge(
  edge: EdgePlan,
  hits: Map<EdgePlan, () => Word.Range | null>,
  points: Map<EdgePlan, Word.Range | null>,
): Word.Range | null {
  if (edge.kind === "content") return edge.paragraph.getRange("Content");
  if (edge.kind === "hit") return hits.get(edge)?.() ?? null;
  return points.get(edge) ?? null;
}

interface AddWrite {
  proven: ProvenAdd[];
  /** String(id) per row, when the insert sync returned them. */
  ids: Map<number, string>;
  /** The insert sync threw: which rows landed is read afterwards (F-17). */
  thrown: unknown;
  before: Set<string>;
  refused: WordCommentRowResult[];
}

async function runAdds(
  draft: WordCommentDraft,
  rows: WordCommentDraftRow[],
  options: WordCommentExecuteOptions,
): Promise<Omit<WordCommentRun, "rows"> & { rows: WordCommentRowResult[] }> {
  const support = currentWordSelectionSupport();
  const host = options.host ?? wordHostPlatform();
  const assistantRows = new Set(
    options.assistantAuthor
      ? rows
          .filter((row) => !options.userModeRows?.has(row.i))
          .map((row) => row.i)
      : [],
  );
  const guarded = await runWordGuarded<AddWrite>(
    async (context, guard) => {
      const refused: WordCommentRowResult[] = [];
      const refuse = (row: WordCommentDraftRow, code: WordCommentRefusalCode) =>
        refused.push({ i: row.i, op: row.op, status: "refused", code });
      const story = await readWordStory(context);
      const plans: AddPlan[] = [];
      for (const row of rows) {
        const plan = planAdd(row, story, support);
        if (typeof plan === "string") refuse(row, plan);
        else plans.push(plan);
      }
      const listed = context.document.body.getComments();
      listed.load("items/id");
      const document = context.document;
      if (assistantRows.size) document.load("changeTrackingMode");
      for (const plan of plans)
        for (const edge of plan.edges)
          if (edge.kind === "hit")
            edge.hits = queueWordSearch(
              edge.target.paragraph,
              edge.target.rangeText.slice(edge.target.start, edge.target.end),
            );
      await context.sync();
      const before = new Set(listed.items.map((comment) => String(comment.id)));
      const hits = new Map<EdgePlan, () => Word.Range | null>();
      let pending = false;
      for (const plan of plans)
        for (const edge of plan.edges)
          if (edge.kind === "hit") {
            const proof = queueWordSearchHitProof(
              edge.hits!,
              edge.target,
              support.prefixRanges,
            );
            pending ||= proof.pending;
            hits.set(edge, proof.settle);
          }
      if (pending) await context.sync();
      const points = new Map<EdgePlan, Word.Range | null>();
      for (const plan of plans)
        for (const edge of plan.edges)
          if (edge.kind === "points") {
            const built = await buildWordSelectionRanges(
              context,
              [edge.target],
              support,
            );
            const part = "parts" in built ? built.parts[0] : undefined;
            points.set(edge, part?.kind === "part" ? part.range : null);
          }
      const tracking =
        assistantRows.size && document.changeTrackingMode !== "Off";
      const proven: ProvenAdd[] = [];
      for (const plan of plans) {
        const ranges = plan.edges.map((edge) =>
          settledEdge(edge, hits, points),
        );
        if (ranges.some((range) => !range)) {
          refuse(plan.row, "TARGET_RANGE_UNPROVEN");
          continue;
        }
        // O-28: conditions changed since the card showed AI-author mode; the user decides again.
        if (tracking && assistantRows.has(plan.row.i)) {
          refuse(plan.row, "AUTHOR_MODE_UNAVAILABLE");
          continue;
        }
        proven.push({
          row: plan.row,
          range:
            ranges.length === 1 ? ranges[0]! : ranges[0]!.expandTo(ranges[1]!),
          firstPosition: plan.positions[0],
          start: plan.add.start,
        });
      }
      // Several writes in one sync land by offsets taken before it on the web: last first.
      proven.sort(
        (a, b) => b.firstPosition - a.firstPosition || b.start - a.start,
      );
      const ids = new Map<number, string>();
      if (!proven.length) return { proven, ids, thrown: null, before, refused };
      guard.beforeWrite();
      const inserted = proven.map((add) => {
        const comment = add.range.insertComment(add.row.finalText!);
        comment.load("id");
        return comment;
      });
      try {
        await context.sync();
      } catch (thrown) {
        return { proven, ids, thrown, before, refused };
      }
      proven.forEach((add, k) => ids.set(add.row.i, String(inserted[k].id)));
      return { proven, ids, thrown: null, before, refused };
    },
    { timeoutMs: timeoutFor(rows.length) },
  );

  if (guarded.outcome !== "ok" || !guarded.value) {
    const status: WordCommentRowStatus = guarded.writeQueued
      ? "unverified"
      : "failed";
    return {
      rows: rows.map((row) => ({
        i: row.i,
        op: row.op,
        status,
        ...(guarded.outcome === "error"
          ? { code: refusalOf(guarded.error) }
          : {}),
      })),
      settled: guarded.settled,
      timedOut: guarded.outcome === "timeout",
    };
  }
  const write = guarded.value;
  if (write.thrown) noteWordCommentHostError("add", write.thrown);
  const verified = await verifyAdds(draft, write, host, options.pollMs);
  const results = [...write.refused, ...verified];

  const toReattribute = verified
    .filter(
      (result) => result.status === "applied" && assistantRows.has(result.i),
    )
    .map((result) => ({
      row: rows.find((row) => row.i === result.i)!,
      commentId: result.commentId!,
    }))
    .filter(({ row }) => row.add!.rangeTexts.length === 1);
  let settled = SETTLED;
  let timedOut = false;
  if (toReattribute.length && options.reattribute && options.assistantAuthor) {
    const rewrite = await options.reattribute({
      draft,
      rows: toReattribute,
      authorName: options.assistantAuthor,
    });
    ({ settled, timedOut } = rewrite);
    const { outcomes } = rewrite;
    for (const result of results) {
      const outcome = outcomes.get(result.i);
      if (!outcome) continue;
      const row = rows.find((r) => r.i === result.i)!;
      result.status = outcome.status;
      if (outcome.code) result.code = outcome.code;
      if (outcome.status === "applied") {
        result.author = "assistant";
        result.revert = {
          kind: "delete-comment",
          commentId: result.commentId!,
          content: row.text!,
          author: options.assistantAuthor,
        };
      }
    }
  }
  // AI-author mode never falls back silently: a row it could not re-attribute says so.
  if (options.assistantAuthor && !options.reattribute)
    for (const result of results)
      if (result.status === "applied" && assistantRows.has(result.i)) {
        result.status = "applied_as_user";
        result.code = "AUTHOR_MODE_UNAVAILABLE";
      }
  for (const result of results)
    if (result.status === "applied_as_user") result.author = "user";
  return { rows: results, settled, timedOut };
}

async function verifyAdds(
  draft: WordCommentDraft,
  write: AddWrite,
  host: WordHostPlatform,
  pollMs = WORD_COMMENT_WEB_POLL_MS,
): Promise<WordCommentRowResult[]> {
  const registry = wordCommentRefRegistry(draft.identity);
  const ranged = host === "PC" || host === "Mac";
  const polls = host === "OfficeOnline" ? WORD_COMMENT_WEB_POLLS : 1;
  let last: WordCommentRowResult[] = [];
  for (let attempt = 0; attempt < polls; attempt += 1) {
    if (attempt > 0) await sleep(pollMs);
    const read = await runWordGuarded(
      async (context) => {
        const comments = context.document.body.getComments();
        comments.load("items/id,items/content,items/authorName");
        await context.sync();
        const byId = new Map<string, Word.Comment[]>();
        for (const comment of comments.items) {
          const id = String(comment.id);
          byId.set(id, [...(byId.get(id) ?? []), comment]);
        }
        // Placement: desktop reads the new anchor's text; the web only asks its first paragraph.
        const anchors = new Map<number, Word.Range>();
        const paragraphLists = new Map<number, Word.CommentCollection>();
        let story: WordStoryRead | null = null;
        if (!ranged && write.ids.size) story = await readWordStory(context);
        for (const add of write.proven) {
          const id = write.ids.get(add.row.i);
          const found = id ? byId.get(id) : undefined;
          if (found?.length !== 1) continue;
          if (ranged && add.row.add!.rangeTexts.length === 1) {
            const range = found[0].getRange();
            range.load("text");
            anchors.set(add.row.i, range);
          } else if (story) {
            const resolved = resolveWordParagraphs(
              add.row.add!.anchor,
              story.entries,
            );
            if ("positions" in resolved) {
              const list = story.items[resolved.positions[0]].getComments();
              list.load("items/id");
              paragraphLists.set(add.row.i, list);
            }
          }
        }
        if (anchors.size || paragraphLists.size) await context.sync();
        return { comments: comments.items, byId, anchors, paragraphLists };
      },
      { timeoutMs: WORD_COMMENT_RUN_TIMEOUT_MS },
    );
    if (read.outcome !== "ok" || !read.value) {
      const code = wordCommentErrorCode(read.error) ?? "READ_FAILED";
      last = write.proven.map((add) => ({
        i: add.row.i,
        op: add.row.op,
        status: "unverified",
        code,
      }));
      continue;
    }
    const { byId, anchors, paragraphLists, comments } = read.value;
    const fresh = comments.filter(
      (comment) => !write.before.has(String(comment.id)),
    );
    const claimed = new Set(write.ids.values());
    last = write.proven.map((add): WordCommentRowResult => {
      const base = { i: add.row.i, op: add.row.op };
      let id = write.ids.get(add.row.i);
      if (!id) {
        // The insert sync threw: a fresh comment with the row's text is its write (F-17).
        const match = fresh.find(
          (comment) =>
            !claimed.has(String(comment.id)) &&
            sameCommentText(comment.content, add.row.finalText!),
        );
        // Absent after a throw is proof on desktop (F-17); the web may still show it later.
        if (!match)
          return host === "OfficeOnline"
            ? { ...base, status: "unverified", code: "NOT_LISTED" }
            : { ...base, status: "failed", code: refusalOf(write.thrown) };
        id = String(match.id);
        claimed.add(id);
      }
      const found = byId.get(id);
      if (!found || found.length !== 1)
        return {
          ...base,
          status: "unverified",
          code: "NOT_LISTED",
          commentId: id,
        };
      if (!sameCommentText(found[0].content, add.row.finalText!))
        return {
          ...base,
          status: "unverified",
          code: "CONTENT_MISMATCH",
          commentId: id,
        };
      const range = anchors.get(add.row.i);
      const add1 = add.row.add!;
      if (
        range &&
        range.text !== add1.rangeTexts[0].slice(add1.start, add1.end)
      )
        return {
          ...base,
          status: "unverified",
          code: "ANCHOR_UNPROVEN",
          commentId: id,
        };
      const list = paragraphLists.get(add.row.i);
      if (list && !list.items.some((comment) => String(comment.id) === id))
        return {
          ...base,
          status: "unverified",
          code: "ANCHOR_UNPROVEN",
          commentId: id,
        };
      const newRef = draft.legacy
        ? null
        : wordCommentNewThreadRef(registry, id);
      return {
        ...base,
        status: "applied",
        commentId: id,
        author: "user",
        ...(newRef ? { newRef } : {}),
        revert: {
          kind: "delete-comment",
          commentId: id,
          content: add.row.finalText!,
          author: found[0].authorName,
        },
      };
    });
    if (last.every((row) => row.status !== "unverified")) break;
  }
  return last;
}

// ---------------------------------------------------------------- threads

interface LiveThread {
  comment: Word.Comment;
  replies: Word.CommentReply[];
}

type Found =
  | { ok: true; live: LiveThread }
  | { ok: false; code: "THREAD_NOT_FOUND" | "THREAD_AMBIGUOUS" };

/** Lists the body's comments and the replies of the threads named; exactly one match each. */
async function findThreads(
  context: Word.RequestContext,
  ids: readonly string[],
): Promise<Map<string, Found>> {
  const comments = context.document.body.getComments();
  comments.load(COMMENT_FIELDS);
  await context.sync();
  const byId = new Map<string, Word.Comment[]>();
  for (const comment of comments.items) {
    const id = String(comment.id);
    byId.set(id, [...(byId.get(id) ?? []), comment]);
  }
  const found = new Map<string, Found>();
  const replies = new Map<string, Word.CommentReplyCollection>();
  for (const id of new Set(ids)) {
    const matches = byId.get(id) ?? [];
    if (matches.length !== 1) {
      found.set(id, {
        ok: false,
        code: matches.length ? "THREAD_AMBIGUOUS" : "THREAD_NOT_FOUND",
      });
      continue;
    }
    const list = matches[0].replies;
    list.load(REPLY_FIELDS);
    replies.set(id, list);
  }
  if (replies.size) await context.sync();
  for (const [id, list] of replies)
    found.set(id, {
      ok: true,
      live: { comment: byId.get(id)![0], replies: list.items },
    });
  return found;
}

const sameEntry = (
  live: { content: string; authorName: string },
  print: WordCommentEntryFingerprint,
) =>
  live.authorName === print.author &&
  sameCommentText(live.content, print.content);

const sameIds = (
  live: readonly { id: unknown }[],
  captured: readonly string[] | null,
) =>
  captured !== null &&
  live.length === captured.length &&
  live.every((item, k) => String(item.id) === captured[k]);

type ReadBack = Awaited<ReturnType<typeof readOnce>>;

/**
 * Judges rows on fresh reads. Word for the web may show a write a moment later, so there the rows
 * are read again until none is still failed or unverified, or the polls run out.
 */
async function judgeFresh<R extends { status: string }>(
  host: WordHostPlatform,
  ids: readonly string[],
  pollMs: number,
  judge: (back: ReadBack) => R[],
): Promise<R[]> {
  const polls = host === "OfficeOnline" ? WORD_COMMENT_WEB_POLLS : 1;
  let judged: R[] = [];
  for (let attempt = 0; attempt < polls; attempt += 1) {
    if (attempt > 0) await sleep(pollMs);
    judged = judge(await readOnce(ids));
    if (!judged.some((r) => r.status === "failed" || r.status === "unverified"))
      break;
  }
  return judged;
}

async function readOnce(ids: readonly string[]) {
  const read = await runWordGuarded(
    async (context) => {
      const found = await findThreads(context, ids);
      return new Map(
        [...found].map(([id, entry]) => [
          id,
          entry.ok
            ? {
                resolved: entry.live.comment.resolved,
                content: entry.live.comment.content,
                replies: entry.live.replies.map((reply) => ({
                  id: String(reply.id),
                  content: reply.content,
                })),
              }
            : null,
        ]),
      );
    },
    { timeoutMs: WORD_COMMENT_RUN_TIMEOUT_MS },
  );
  return read.outcome === "ok" ? (read.value ?? null) : null;
}

type RespondPhase = "reopen" | "reply" | "resolve";
const RESPOND_PHASES: readonly RespondPhase[] = ["reopen", "reply", "resolve"];

type Decision =
  | { kind: "write"; live: LiveThread; replyId?: string; thrown?: boolean }
  | { kind: "unchanged" }
  | { kind: "refused" | "failed"; code?: string };

/** Fingerprint and state checks for a reply, resolve or reopen (contract §10). */
function respondDecision(
  row: WordCommentDraftRow,
  entry: Found,
  dependency: Decision | undefined,
): Decision {
  if (
    row.dependsOn !== undefined &&
    dependency?.kind !== "write" &&
    dependency?.kind !== "unchanged"
  )
    return { kind: "refused", code: "DEPENDENCY_NOT_MET" };
  if (!entry.ok) return { kind: "refused", code: entry.code };
  const { live } = entry;
  const print = row.thread!.fingerprint;
  if (!sameIds(live.replies, print.replyIds))
    return { kind: "refused", code: "NEW_ACTIVITY" };
  if (!sameEntry(live.comment, print))
    return { kind: "refused", code: "THREAD_CHANGED" };
  const resolved = live.comment.resolved;
  if (row.op === "reply")
    // A resolved thread is replied to only after its own reopen: the web refuses otherwise (F-18).
    return resolved !== print.resolved ||
      (resolved && row.dependsOn === undefined)
      ? { kind: "refused", code: "STATE_CHANGED" }
      : { kind: "write", live };
  const target = row.op === "resolve";
  if (resolved === target) return { kind: "unchanged" };
  return resolved !== print.resolved
    ? { kind: "refused", code: "STATE_CHANGED" }
    : { kind: "write", live };
}

async function runResponds(
  draft: WordCommentDraft,
  rows: WordCommentDraftRow[],
  options: WordCommentExecuteOptions,
): Promise<WordCommentRun> {
  const host = options.host ?? wordHostPlatform();
  const decisions = new Map<number, Decision>();
  const guarded = await runWordGuarded(
    async (context, guard) => {
      const found = await findThreads(
        context,
        rows.map((row) => row.thread!.commentId),
      );
      for (const row of rows)
        decisions.set(
          row.i,
          respondDecision(
            row,
            found.get(row.thread!.commentId)!,
            row.dependsOn === undefined
              ? undefined
              : decisions.get(row.dependsOn),
          ),
        );
      const writing = rows.filter(
        (row) => decisions.get(row.i)!.kind === "write",
      );
      if (!writing.length) return;
      guard.beforeWrite();
      for (const phase of RESPOND_PHASES) {
        const batch = writing.filter((row) => row.op === phase);
        if (!batch.length) continue;
        const replies = batch.map((row) => {
          const decision = decisions.get(row.i) as Extract<
            Decision,
            { kind: "write" }
          >;
          if (phase === "reply") {
            const reply = decision.live.comment.reply(row.finalText!);
            reply.load("id");
            return reply;
          }
          decision.live.comment.resolved = phase === "resolve";
          return null;
        });
        try {
          await context.sync();
        } catch (error) {
          noteWordCommentHostError("respond", error);
          for (const row of batch)
            (
              decisions.get(row.i) as Extract<Decision, { kind: "write" }>
            ).thrown = true;
          const code = refusalOf(error);
          // Later phases are not attempted: their own rows wrote nothing, their pairs never ran.
          for (const row of writing)
            if (
              RESPOND_PHASES.indexOf(row.op as RespondPhase) >
              RESPOND_PHASES.indexOf(phase)
            )
              decisions.set(
                row.i,
                row.dependsOn !== undefined &&
                  batch.some((b) => b.i === row.dependsOn)
                  ? { kind: "refused", code: "DEPENDENCY_NOT_MET" }
                  : { kind: "failed", code },
              );
          return;
        }
        batch.forEach((row, k) => {
          if (replies[k])
            (
              decisions.get(row.i) as Extract<Decision, { kind: "write" }>
            ).replyId = String(replies[k].id);
        });
      }
    },
    { timeoutMs: timeoutFor(rows.length) },
  );

  const result = (
    row: WordCommentDraftRow,
    status: WordCommentRowStatus,
    extra: Partial<WordCommentRowResult> = {},
  ): WordCommentRowResult => ({
    i: row.i,
    op: row.op,
    ref: row.ref,
    status,
    commentId: row.thread!.commentId,
    ...extra,
  });
  if (guarded.outcome !== "ok") {
    const code =
      guarded.outcome === "error" ? refusalOf(guarded.error) : undefined;
    return {
      rows: rows.map((row) => {
        const decision = decisions.get(row.i);
        if (decision?.kind === "unchanged") return result(row, "unchanged");
        if (decision?.kind === "refused" || decision?.kind === "failed")
          return result(
            row,
            decision.kind,
            decision.code ? { code: decision.code } : {},
          );
        return result(
          row,
          guarded.writeQueued && decision ? "unverified" : "failed",
          code ? { code } : {},
        );
      }),
      settled: guarded.settled,
      timedOut: guarded.outcome === "timeout",
    };
  }
  const written = rows.filter((row) => decisions.get(row.i)?.kind === "write");
  const web = host === "OfficeOnline";
  const judge = (back: ReadBack): WordCommentRowResult[] =>
    rows.map((row) => {
      const decision = decisions.get(row.i)!;
      if (decision.kind === "unchanged") return result(row, "unchanged");
      if (decision.kind !== "write")
        return result(
          row,
          decision.kind,
          decision.code ? { code: decision.code } : {},
        );
      if (!back) return result(row, "unverified", { code: "READ_FAILED" });
      const live = back.get(row.thread!.commentId);
      if (!live)
        return result(row, decision.thrown ? "failed" : "unverified", {
          code: "THREAD_NOT_FOUND",
        });
      if (row.op === "reply") {
        const captured = new Set(row.thread!.fingerprint.replyIds ?? []);
        const index = decision.replyId
          ? live.replies.findIndex((reply) => reply.id === decision.replyId)
          : live.replies.findIndex(
              (reply) =>
                !captured.has(reply.id) &&
                sameCommentText(reply.content, row.finalText!),
            );
        const reply = live.replies[index];
        // A reply the web has not shown after a throw may still land: it is never retried.
        if (!reply)
          return decision.thrown && !web
            ? result(row, "failed", { code: "WRITE_FAILED" })
            : result(row, "unverified", { code: "NOT_LISTED" });
        if (!sameCommentText(reply.content, row.finalText!))
          return result(row, "unverified", { code: "CONTENT_MISMATCH" });
        return result(row, "applied", {
          commentId: reply.id,
          newRef: `${row.thread!.ref}.${index + 1}`,
          revert: {
            kind: "delete-reply",
            threadId: row.thread!.commentId,
            replyId: reply.id,
            content: row.finalText!,
          },
        });
      }
      const target = row.op === "resolve";
      return live.resolved === target
        ? result(row, "applied", {
            revert: {
              kind: "set-resolved",
              threadId: row.thread!.commentId,
              from: target,
              to: !target,
            },
          })
        : result(
            row,
            "failed",
            decision.thrown ? { code: "WRITE_FAILED" } : {},
          );
    });
  return {
    rows: written.length
      ? await judgeFresh(
          host,
          written.map((row) => row.thread!.commentId),
          options.pollMs ?? WORD_COMMENT_WEB_POLL_MS,
          judge,
        )
      : judge(null),
    settled: SETTLED,
    timedOut: false,
  };
}

async function runModifies(
  draft: WordCommentDraft,
  rows: WordCommentDraftRow[],
  options: WordCommentExecuteOptions,
): Promise<WordCommentRun> {
  const host = options.host ?? wordHostPlatform();
  const results = new Map<number, WordCommentRowResult>();
  const settle = (
    row: WordCommentDraftRow,
    status: WordCommentRowStatus,
    code?: string,
  ) =>
    results.set(row.i, {
      i: row.i,
      op: row.op,
      ref: row.ref,
      status,
      ...(code ? { code } : {}),
      commentId: row.entry!.fingerprint.id,
    });
  const writes: { row: WordCommentDraftRow; thrown?: boolean }[] = [];
  const guarded = await runWordGuarded(
    async (context, guard) => {
      const found = await findThreads(
        context,
        rows.map((row) => row.thread!.commentId),
      );
      const queued: (() => void)[] = [];
      for (const row of rows) {
        const entry = found.get(row.thread!.commentId)!;
        if (!entry.ok) {
          settle(row, "refused", entry.code);
          continue;
        }
        const { live } = entry;
        const target = row.entry!;
        const print = row.thread!.fingerprint;
        if (target.n === 0) {
          if (!sameEntry(live.comment, print)) {
            settle(row, "refused", "THREAD_CHANGED");
            continue;
          }
          if (row.op === "delete") {
            // Delete takes the replies with it, so every one must be the one shown (Annex B §3.g).
            if (!sameIds(live.replies, print.replyIds)) {
              settle(row, "refused", "NEW_ACTIVITY");
              continue;
            }
            if (
              !live.replies.every((reply, k) =>
                sameEntry(reply, print.replies![k]),
              )
            ) {
              settle(row, "refused", "THREAD_CHANGED");
              continue;
            }
            queued.push(() => live.comment.delete());
          } else queued.push(() => (live.comment.content = row.finalText!));
        } else {
          const reply = live.replies.find(
            (r) => String(r.id) === target.fingerprint.id,
          );
          if (!reply) {
            settle(row, "refused", "REPLY_NOT_FOUND");
            continue;
          }
          if (!sameEntry(reply, target.fingerprint)) {
            settle(row, "refused", "THREAD_CHANGED");
            continue;
          }
          if (row.op === "delete") queued.push(() => reply.delete());
          else queued.push(() => (reply.content = row.finalText!));
        }
        writes.push({ row });
      }
      if (!queued.length) return;
      guard.beforeWrite();
      for (const write of queued) write();
      try {
        await context.sync();
      } catch (error) {
        noteWordCommentHostError("modify", error);
        for (const write of writes) write.thrown = true;
      }
    },
    { timeoutMs: timeoutFor(rows.length) },
  );
  if (guarded.outcome !== "ok") {
    for (const row of rows)
      if (!results.has(row.i))
        settle(
          row,
          guarded.writeQueued ? "unverified" : "failed",
          guarded.outcome === "error" ? refusalOf(guarded.error) : undefined,
        );
    return {
      rows: rows.map((row) => results.get(row.i)!),
      settled: guarded.settled,
      timedOut: guarded.outcome === "timeout",
    };
  }
  if (writes.length) {
    const outcome = (
      row: WordCommentDraftRow,
      status: WordCommentRowStatus,
      code?: string,
    ): WordCommentRowResult => ({
      i: row.i,
      op: row.op,
      ref: row.ref,
      status,
      ...(code ? { code } : {}),
      commentId: row.entry!.fingerprint.id,
    });
    const judge = (back: ReadBack): WordCommentRowResult[] =>
      writes.map(({ row, thrown }) => {
        if (!back) return outcome(row, "unverified", "READ_FAILED");
        const live = back.get(row.thread!.commentId);
        const target = row.entry!;
        if (row.op === "delete") {
          const gone =
            target.n === 0
              ? !live
              : !!live &&
                !live.replies.some(
                  (reply) => reply.id === target.fingerprint.id,
                );
          return outcome(row, gone ? "applied" : "failed");
        }
        const content =
          target.n === 0
            ? live?.content
            : live?.replies.find((reply) => reply.id === target.fingerprint.id)
                ?.content;
        if (content !== undefined && sameCommentText(content, row.finalText!))
          return {
            ...outcome(row, "applied"),
            revert: {
              kind: "restore-content",
              threadId: row.thread!.commentId,
              replyId: target.n === 0 ? null : target.fingerprint.id,
              previous: target.fingerprint.content,
              written: row.finalText!,
            },
          };
        if (
          content !== undefined &&
          sameCommentText(content, target.fingerprint.content)
        )
          return outcome(row, "failed", thrown ? "WRITE_FAILED" : undefined);
        return outcome(
          row,
          "unverified",
          content === undefined ? "NOT_LISTED" : "CONTENT_MISMATCH",
        );
      });
    const judged = await judgeFresh(
      host,
      writes.map((write) => write.row.thread!.commentId),
      options.pollMs ?? WORD_COMMENT_WEB_POLL_MS,
      judge,
    );
    for (const row of judged) results.set(row.i, row);
  }
  return {
    rows: rows.map((row) => results.get(row.i)!),
    settled: SETTLED,
    timedOut: false,
  };
}

// ---------------------------------------------------------------- revert

export type WordCommentRevertStatus =
  | "reverted"
  /** Changed since Erato wrote it, or gone: left alone. */
  | "stale"
  | "failed"
  | "unverified";

export interface WordCommentRevertResult {
  i: number;
  status: WordCommentRevertStatus;
}

/** Erato's Revert, once: each step only where Word still shows exactly what Erato wrote. */
export async function revertWordCommentRows(
  steps: readonly { i: number; step: WordCommentRevertStep }[],
  host: WordHostPlatform = wordHostPlatform(),
  pollMs = WORD_COMMENT_WEB_POLL_MS,
): Promise<{
  rows: WordCommentRevertResult[];
  settled: Promise<void>;
  timedOut: boolean;
}> {
  const outcome = new Map<number, WordCommentRevertStatus>();
  const acted: { i: number; step: WordCommentRevertStep }[] = [];
  const threadOf = (step: WordCommentRevertStep) =>
    step.kind === "delete-comment" ? step.commentId : step.threadId;
  const guarded = await runWordGuarded(
    async (context, guard) => {
      const found = await findThreads(
        context,
        steps.map(({ step }) => threadOf(step)),
      );
      const queued: (() => void)[] = [];
      // Last first: a reply comes off its thread before the thread is resolved again (F-18).
      for (const { i, step } of [...steps].reverse()) {
        const entry = found.get(threadOf(step));
        if (!entry?.ok) {
          outcome.set(i, "stale");
          continue;
        }
        const { comment, replies } = entry.live;
        switch (step.kind) {
          case "delete-comment":
            if (
              replies.length ||
              comment.authorName !== step.author ||
              !sameCommentText(comment.content, step.content)
            ) {
              outcome.set(i, "stale");
              continue;
            }
            queued.push(() => comment.delete());
            break;
          case "delete-reply": {
            const reply = replies.find((r) => String(r.id) === step.replyId);
            if (!reply || !sameCommentText(reply.content, step.content)) {
              outcome.set(i, "stale");
              continue;
            }
            queued.push(() => reply.delete());
            break;
          }
          case "set-resolved":
            if (comment.resolved !== step.from) {
              outcome.set(i, "stale");
              continue;
            }
            queued.push(() => (comment.resolved = step.to));
            break;
          case "restore-content": {
            const item = step.replyId
              ? replies.find((r) => String(r.id) === step.replyId)
              : comment;
            if (!item || !sameCommentText(item.content, step.written)) {
              outcome.set(i, "stale");
              continue;
            }
            queued.push(() => (item.content = step.previous));
            break;
          }
        }
        acted.push({ i, step });
      }
      if (!queued.length) return;
      guard.beforeWrite();
      for (const write of queued) write();
      await context.sync();
    },
    { timeoutMs: timeoutFor(steps.length) },
  );
  if (guarded.outcome !== "ok") {
    for (const { i } of acted)
      outcome.set(i, guarded.writeQueued ? "unverified" : "failed");
    for (const { i } of steps) if (!outcome.has(i)) outcome.set(i, "failed");
    return {
      rows: steps.map(({ i }) => ({ i, status: outcome.get(i)! })),
      settled: guarded.settled,
      timedOut: guarded.outcome === "timeout",
    };
  }
  if (acted.length) {
    const judged = await judgeFresh(
      host,
      acted.map(({ step }) => threadOf(step)),
      pollMs,
      (back): WordCommentRevertResult[] =>
        acted.map(({ i, step }) => {
          if (!back) return { i, status: "unverified" };
          const live = back.get(threadOf(step));
          const done =
            step.kind === "delete-comment"
              ? !live
              : step.kind === "delete-reply"
                ? !!live &&
                  !live.replies.some((reply) => reply.id === step.replyId)
                : step.kind === "set-resolved"
                  ? live?.resolved === step.to
                  : !!live &&
                    sameCommentText(
                      step.replyId
                        ? (live.replies.find(
                            (reply) => reply.id === step.replyId,
                          )?.content ?? "")
                        : live.content,
                      step.previous,
                    );
          return { i, status: done ? "reverted" : "failed" };
        }),
    );
    for (const row of judged) outcome.set(row.i, row.status);
  }
  return {
    rows: steps.map(({ i }) => ({ i, status: outcome.get(i)! })),
    settled: SETTLED,
    timedOut: false,
  };
}
