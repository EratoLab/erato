import {
  isAcceptedWordPartsFinish,
  isAcceptedWordSectionPart,
  isAcceptedWordSectionPlan,
  wordDocumentTableStyle,
  wordPartsLayout,
  wordPlainTextBlocks,
} from "@erato/frontend/word-review";

import { wordBlockIndex, wordCaptureSections } from "./wordDocumentOutline";
import { wordLeftOutPartName, wordTitledEntry } from "./wordPlanCoverage";
import { wordBlockTitle, wordPassageStart } from "./wordPlanDocumentChanges";
import { wordWrittenChanges } from "./wordReadFreshness";
import { WORD_PLAN_PATH, WORD_PLAN_PATH_IN_TEXT } from "./wordScopedSubmission";

import type { WordLeftOutPart } from "./wordPlanCoverage";
import type { WordReadCapture } from "./wordReadFreshness";
import type {
  ClientToolExecutionResult,
  ContentPart,
} from "@erato/frontend/library";
import type {
  WordPlainTextOrigin,
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanDiagnostics,
  WordPlanEntry,
  WordPlanRun,
} from "@erato/frontend/word-review";

/**
 * A large change as a section plan, one part per rewritten row and a finish (ERMAIN-1293). Every
 * call is checked by the shipping validator on the plan it assembles to, so finish only joins them.
 */

export type WordPartRowAction = "keep" | "rewrite" | "delete";

export interface WordPartRow {
  action: WordPartRowAction;
  /** In output order; several ranges in one row merge them. */
  refs: string[];
  change?: string;
  /** A keep row's new text for the heading it starts with. */
  title?: string;
  reason?: string;
}

export interface WordPartsPlan {
  intent: string;
  terms: string[];
  rows: WordPartRow[];
}

export type WordPartOp =
  | { kind: "keep"; refs: string[] }
  | { kind: "replace"; refs: string[]; text: string }
  | { kind: "insert"; text: string }
  | { kind: "delete"; refs: string[]; reason: string };

export interface WordPartsDraft {
  id: string;
  revision: number;
  /** The complete read's final token the section plan was sent with. */
  readToken: string;
  plan: WordPartsPlan;
  parts: Map<number, WordPartOp[]>;
  /** A finish at this revision was refused for rows without a part, so the next one leaves them. */
  unwrittenRefusedAt?: number;
}

/** The part of the section plan an assembled entry or deletion came from. */
export type WordPartOrigin =
  | { row: number; title?: true }
  | {
      row: number;
      op: number;
      field: "keep" | "replace" | "insert" | "delete";
      lines?: WordPlainTextOrigin[];
    };

export interface WordPartsAssembly {
  plan: WordDocumentPlan;
  entries: WordPartOrigin[];
  deleted: WordPartOrigin[];
  /** Plain-text slips, per row, with paths into that row's part. */
  textIssues: Map<number, WordPlanDiagnostics>;
}

export const MAX_WORD_PART_ROWS = 200;
export const MAX_WORD_PART_OPS = 200;
const MAX_TEXT = 1000;
const MAX_TITLE = 200;
const MAX_TERMS = 50;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
const line = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max && !/[\r\n]/u.test(v);
const prose = (v: unknown, max: number): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;

/** Refs and ranges such as `b1-b57,b60`, expanded in the order written; a string is why not. */
export function wordPartRefs(
  spec: unknown,
  snapshot: WordAuthoringSnapshot,
): string[] | string {
  if (typeof spec !== "string" || !spec.trim())
    return "Give the blocks as refs and ranges from the read, like b1-b57,b60.";
  const index = wordBlockIndex(snapshot);
  const refs: string[] = [];
  for (const item of spec.split(",")) {
    const range = /^\s*([^\s,–-]+)\s*(?:[-–]\s*([^\s,–-]+))?\s*$/u.exec(item);
    const from = range ? index.get(range[1]) : undefined;
    const to = range?.[2] === undefined ? from : index.get(range[2]);
    if (!range || from === undefined || to === undefined)
      return `"${item.trim().slice(0, 40)}" is not a block or range of this document; use refs and ranges from the read, like b1-b57,b60.`;
    if (to < from)
      return `A range runs from the earlier block to the later one, like ${range[2]}-${range[1]}.`;
    for (let at = from; at <= to; at++) refs.push(snapshot.blocks[at].ref);
  }
  return refs;
}

export function wordPartRanges(
  refs: readonly string[],
  snapshot: WordAuthoringSnapshot,
): string {
  const index = wordBlockIndex(snapshot);
  const positions = refs
    .map((ref) => index.get(ref))
    .filter((at): at is number => at !== undefined);
  const out: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    let j = i;
    while (j + 1 < positions.length && positions[j + 1] === positions[j] + 1)
      j++;
    const first = snapshot.blocks[positions[i]].ref;
    out.push(i === j ? first : `${first}-${snapshot.blocks[positions[j]].ref}`);
    i = j;
  }
  return out.join(",");
}

/** The heading a keep row's `title` renames: the block the row starts with. */
function renamedHeading(
  row: Pick<WordPartRow, "refs">,
  snapshot: WordAuthoringSnapshot,
) {
  const first = snapshot.blocks[wordBlockIndex(snapshot).get(row.refs[0])!];
  return first?.type === "heading" ? first : undefined;
}

/**
 * A row by the document's own name for it, never a ref. A row that spans several sections names
 * the first and last, so an unwritten merge is not named after one section only; otherwise the
 * section its first block lies in, else one it starts, else the start of its text.
 */
export function wordPartRowLabel(
  row: Pick<WordPartRow, "refs">,
  snapshot: WordAuthoringSnapshot,
): WordLeftOutPart {
  const index = wordBlockIndex(snapshot);
  const sections = wordCaptureSections(snapshot);
  const positions = row.refs
    .map((ref) => index.get(ref))
    .filter((at): at is number => at !== undefined);
  const first = positions[0];
  if (first === undefined) return {};
  const chains = positions.map((at) =>
    sections.outline
      .filter(
        (entry) => wordTitledEntry(entry) && entry.from <= at && at < entry.to,
      )
      .sort((a, b) => a.level - b.level),
  );
  let depth = 0;
  while (
    chains.every((chain) => chain[depth] && chain[depth] === chains[0][depth])
  )
    depth++;
  const spanned = chains.every((chain) => chain[depth])
    ? [...new Set(chains.map((chain) => chain[depth]))].map((e) => e.title)
    : [];
  if (spanned.length > 1)
    return {
      title: positions.every((at, k) => !k || at === positions[k - 1] + 1)
        ? `${spanned[0]} – ${spanned.at(-1)}`
        : [...spanned.slice(0, 3), ...(spanned.length > 3 ? ["…"] : [])].join(
            ", ",
          ),
    };
  const within = wordBlockTitle(sections, first);
  if (within) return { title: within };
  for (const at of positions) {
    const entry = sections.entryAt.get(at);
    const outline = entry === undefined ? undefined : sections.outline[entry];
    if (wordTitledEntry(outline)) return { title: outline!.title };
  }
  const passage = wordPassageStart(snapshot, first);
  return passage ? { passage } : {};
}

export const wordPartRowTitle = (
  row: Pick<WordPartRow, "refs">,
  snapshot: WordAuthoringSnapshot,
): string => wordLeftOutPartName(wordPartRowLabel(row, snapshot));

/** "Row 6 (§ 9 Haftung)": how messages to the model name a row. */
export const wordPartRowName = (rowIndex: number, title: string) =>
  `Row ${rowIndex + 1}${title ? ` (${title})` : ""}`;

export function parseWordPartsPlan(
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
): { plan: WordPartsPlan } | { issues: WordPlanDiagnostics } {
  const issues: WordPlanDiagnostics = [];
  const issue = (path: string, code: string, message: string) => {
    if (issues.length < 16) issues.push({ path, code, message });
  };
  const unknown = Object.keys(input).find(
    (key) =>
      !["snapshot", "readToken", "intent", "terms", "rows"].includes(key),
  );
  if (unknown !== undefined)
    issue(
      "",
      "plan-shape",
      `A section plan has snapshot, readToken, intent, terms and rows only; remove "${unknown.slice(0, 40)}".`,
    );
  if (!prose(input.intent, MAX_TEXT))
    issue(
      "/intent",
      "plan-shape",
      `intent is one or two sentences of at most ${MAX_TEXT} characters saying what the change does.`,
    );
  const terms = input.terms ?? [];
  if (
    !Array.isArray(terms) ||
    terms.length > MAX_TERMS ||
    !terms.every((term) => line(term, 100))
  )
    issue(
      "/terms",
      "plan-shape",
      `terms lists at most ${MAX_TERMS} terms of the document that every part keeps, each a single line of at most 100 characters.`,
    );
  const rawRows = input.rows;
  if (
    !Array.isArray(rawRows) ||
    !rawRows.length ||
    rawRows.length > MAX_WORD_PART_ROWS
  ) {
    issue(
      "/rows",
      "plan-shape",
      `rows lists 1–${MAX_WORD_PART_ROWS} rows in output order.`,
    );
    return { issues };
  }
  const owner = new Map<string, number>();
  const rows: WordPartRow[] = [];
  rawRows.forEach((raw, k) => {
    const path = `/rows/${k}`;
    if (
      !object(raw) ||
      !only(raw, ["source", "action", "change", "title", "reason"])
    )
      return issue(
        path,
        "row-shape",
        "A row has source, action and, by action, change, title or reason.",
      );
    if (!["keep", "rewrite", "delete"].includes(String(raw.action)))
      return issue(
        `${path}/action`,
        "row-shape",
        "action is keep, rewrite or delete.",
      );
    const action = raw.action as WordPartRowAction;
    const refs = wordPartRefs(raw.source, snapshot);
    if (typeof refs === "string")
      return issue(`${path}/source`, "row-source", refs);
    for (const ref of refs) {
      const earlier = owner.get(ref);
      if (earlier !== undefined) {
        issue(
          `${path}/source`,
          "source-ownership",
          `${ref} is already in row ${earlier + 1}; every block belongs to exactly one row.`,
        );
        break;
      }
      owner.set(ref, k);
    }
    const row: WordPartRow = { action, refs };
    if (action === "rewrite") {
      if (!prose(raw.change, MAX_TEXT))
        issue(
          `${path}/change`,
          "row-shape",
          `A rewrite row says in change, in at most ${MAX_TEXT} characters, what its part changes.`,
        );
      else row.change = raw.change;
    }
    if (action === "delete") {
      if (!prose(raw.reason, MAX_TEXT))
        issue(
          `${path}/reason`,
          "row-shape",
          "A delete row says in reason why its blocks go.",
        );
      else row.reason = raw.reason;
    }
    if (raw.title !== undefined) {
      if (action !== "keep")
        issue(
          `${path}/title`,
          "row-shape",
          "title renames the heading of a keep row; a rewrite row's part writes its own heading.",
        );
      else if (!line(raw.title, MAX_TITLE))
        issue(
          `${path}/title`,
          "row-shape",
          `title is the heading's new text: one line of at most ${MAX_TITLE} characters.`,
        );
      else if (!renamedHeading(row, snapshot)) {
        const first = snapshot.blocks[wordBlockIndex(snapshot).get(refs[0])!];
        issue(
          `${path}/title`,
          "row-shape",
          first.type === "list-item" && first.outlineLevel !== undefined
            ? "This row starts with a numbered heading, which Word numbers itself, so its number follows the row's new place; leave title out, or rewrite the row to change its words."
            : "title renames the heading a keep row starts with, and this row starts with other text; start the row at its heading, or rewrite the row.",
        );
      } else row.title = raw.title;
    }
    rows.push(row);
  });
  const missing = snapshot.blocks
    .map((block) => block.ref)
    .filter((ref) => !owner.has(ref));
  if (missing.length && !issues.length)
    issue(
      "/rows",
      "source-coverage",
      `Blocks in no row: ${wordPartRanges(missing, snapshot)}. Every body block belongs to exactly one keep, rewrite or delete row.`,
    );
  if (issues.length) return { issues };
  return {
    plan: {
      intent: input.intent as string,
      terms: terms as string[],
      rows,
    },
  };
}

export function parseWordPartOps(
  value: unknown,
  rowIndex: number,
  row: WordPartRow,
  snapshot: WordAuthoringSnapshot,
): { ops: WordPartOp[] } | { issues: WordPlanDiagnostics } {
  const issues: WordPlanDiagnostics = [];
  const issue = (path: string, code: string, message: string) => {
    if (issues.length < 16) issues.push({ path, code, message });
  };
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > MAX_WORD_PART_OPS
  )
    return {
      issues: [
        {
          path: "/ops",
          code: "part-shape",
          message: `ops lists 1–${MAX_WORD_PART_OPS} ops in output order.`,
        },
      ],
    };
  const inRow = new Set(row.refs);
  const used = new Map<string, number>();
  const ops: WordPartOp[] = [];
  const take = (spec: unknown, path: string, k: number): string[] => {
    const refs = wordPartRefs(spec, snapshot);
    if (typeof refs === "string") {
      issue(path, "row-source", refs);
      return [];
    }
    for (const ref of refs) {
      if (!inRow.has(ref)) {
        issue(
          path,
          "source-ownership",
          `${ref} is not in row ${rowIndex + 1}; this part uses only the row's blocks, ${wordPartRanges(row.refs, snapshot)}.`,
        );
        return [];
      }
      const earlier = used.get(ref);
      if (earlier !== undefined) {
        issue(
          path,
          "source-ownership",
          `${ref} is already used at /ops/${earlier}; each block of the row is used exactly once.`,
        );
        return [];
      }
      used.set(ref, k);
    }
    return refs;
  };
  value.forEach((raw, k) => {
    const path = `/ops/${k}`;
    const shape = () =>
      issue(
        path,
        "part-shape",
        'An op is {"keep":refs}, {"replace":refs,"text":…}, {"insert":…} or {"delete":refs,"reason":…}.',
      );
    if (!object(raw)) return shape();
    if ("keep" in raw && only(raw, ["keep"]))
      ops.push({ kind: "keep", refs: take(raw.keep, `${path}/keep`, k) });
    else if ("replace" in raw && only(raw, ["replace", "text"])) {
      const refs = take(raw.replace, `${path}/replace`, k);
      if (typeof raw.text !== "string" || !raw.text.trim())
        issue(
          `${path}/text`,
          "text-form",
          "replace needs the new text in the plain-text form; use delete to remove blocks.",
        );
      else ops.push({ kind: "replace", refs, text: raw.text });
    } else if ("insert" in raw && only(raw, ["insert"])) {
      if (typeof raw.insert !== "string" || !raw.insert.trim())
        issue(
          `${path}/insert`,
          "text-form",
          "insert is the new text in the plain-text form.",
        );
      else ops.push({ kind: "insert", text: raw.insert });
    } else if ("delete" in raw && only(raw, ["delete", "reason"])) {
      const refs = take(raw.delete, `${path}/delete`, k);
      if (!prose(raw.reason, MAX_TEXT))
        issue(
          `${path}/reason`,
          "part-shape",
          "A delete op says in reason why.",
        );
      else ops.push({ kind: "delete", refs, reason: raw.reason });
    } else shape();
  });
  const missing = row.refs.filter((ref) => !used.has(ref));
  if (missing.length && !issues.length)
    issue(
      "/ops",
      "source-coverage",
      `Row ${rowIndex + 1}'s blocks ${wordPartRanges(missing, snapshot)} are in no op; keep, replace or delete each block of the row exactly once.`,
    );
  return issues.length ? { issues } : { ops };
}

function uniformRunFormat(
  runs: readonly WordPlanRun[] | undefined,
): Omit<WordPlanRun, "text"> | undefined {
  if (!runs?.length) return undefined;
  const looks = runs.map(({ text: _text, ...look }) => JSON.stringify(look));
  if (looks.some((look) => look !== looks[0])) return undefined;
  const { text: _text, ...look } = runs[0];
  return Object.keys(look).length ? look : undefined;
}

/** A rewrite row without a part keeps its blocks, so every call is checked on the whole draft
 * with its change put in, and a limit such as the plan size stops the part that crosses it. */
export function assembleWordParts(
  snapshot: WordAuthoringSnapshot,
  readToken: string,
  plan: WordPartsPlan,
  parts: ReadonlyMap<number, WordPartOp[]>,
): WordPartsAssembly {
  const index = wordBlockIndex(snapshot);
  const sourceOf = (ref: string) => snapshot.blocks[index.get(ref)!];
  const table = wordDocumentTableStyle(snapshot);
  const entries: WordPlanEntry[] = [];
  const entryOrigins: WordPartOrigin[] = [];
  const deleted: WordDocumentPlan["deleted"] = [];
  const deletedOrigins: WordPartOrigin[] = [];
  const textIssues = new Map<number, WordPlanDiagnostics>();
  const add = (entry: WordPlanEntry, origin: WordPartOrigin) => {
    entries.push(entry);
    entryOrigins.push(origin);
  };
  plan.rows.forEach((row, r) => {
    if (row.action === "delete") {
      deleted.push({ source: row.refs, reason: row.reason ?? "" });
      deletedOrigins.push({ row: r });
      return;
    }
    const ops = row.action === "rewrite" ? parts.get(r) : undefined;
    if (!ops) {
      const heading = row.title ? renamedHeading(row, snapshot) : undefined;
      if (!heading) return add({ kind: "keep", source: row.refs }, { row: r });
      const look = uniformRunFormat(heading.runs);
      add(
        {
          kind: "replace",
          source: [heading.ref],
          blocks: [
            {
              id: `r${r + 1}_title`,
              type: "heading",
              level: heading.level ?? 1,
              text: row.title!,
              ...(look ? { runs: [{ ...look, text: row.title! }] } : {}),
              ...(heading.format ? { format: heading.format } : {}),
            },
          ],
        },
        { row: r, title: true },
      );
      if (row.refs.length > 1)
        add({ kind: "keep", source: row.refs.slice(1) }, { row: r });
      return;
    }
    ops.forEach((op, k) => {
      if (op.kind === "keep")
        return add(
          { kind: "keep", source: op.refs },
          { row: r, op: k, field: "keep" },
        );
      if (op.kind === "delete") {
        deleted.push({ source: op.refs, reason: op.reason });
        deletedOrigins.push({ row: r, op: k, field: "delete" });
        return;
      }
      const field = op.kind === "replace" ? "text" : "insert";
      const converted = wordPlainTextBlocks(op.text, {
        idPrefix: `r${r + 1}_${k + 1}`,
        table,
        replaced: op.kind === "replace" ? op.refs.map(sourceOf) : [],
      });
      const issues = textIssues.get(r) ?? [];
      for (const found of converted.issues)
        if (issues.length < 16)
          issues.push({
            path: `/ops/${k}/${field}`,
            code: "text-form",
            message: found.message,
          });
      if (!converted.blocks.length && !converted.issues.length)
        issues.push({
          path: `/ops/${k}/${field}`,
          code: "text-form",
          message:
            "Line 1: the text has no lines; write the new text, or use delete to remove blocks.",
        });
      if (issues.length) textIssues.set(r, issues);
      if (!converted.blocks.length) return;
      add(
        op.kind === "replace"
          ? { kind: "replace", source: op.refs, blocks: converted.blocks }
          : { kind: "insert", blocks: converted.blocks },
        { row: r, op: k, field: op.kind, lines: converted.origins },
      );
    });
  });
  return {
    plan: {
      version: 1,
      snapshot: snapshot.token,
      readToken,
      scope: "body",
      entries,
      deleted,
    },
    entries: entryOrigins,
    deleted: deletedOrigins,
    textIssues,
  };
}

/** What an issue of the assembled plan is about: who sent it and the line it names. */
function locate(
  path: string,
  assembly: Pick<WordPartsAssembly, "entries" | "deleted">,
): { origin?: WordPartOrigin; path: string; line?: number } {
  const match = WORD_PLAN_PATH.exec(path);
  if (!match) return { path };
  const [, collection, n, rest = ""] = match;
  const origin =
    collection === "entries"
      ? assembly.entries[+n]
      : collection === "deleted"
        ? assembly.deleted[+n]
        : undefined;
  if (!origin) return { path };
  if (!("op" in origin))
    return {
      origin,
      path: `/rows/${origin.row}/${origin.title ? "title" : "source"}`,
    };
  const at = `/ops/${origin.op}`;
  if (origin.field === "keep" || origin.field === "delete")
    return { origin, path: `${at}/${origin.field}` };
  if (rest.startsWith("/source")) return { origin, path: `${at}/replace` };
  const field = `${at}/${origin.field === "replace" ? "text" : "insert"}`;
  const block = /^\/blocks\/(\d+)(?:\/rows\/(\d+))?/u.exec(rest);
  const lines = block && origin.lines?.[+block[1]];
  if (!lines) return { origin, path: field };
  return {
    origin,
    path: field,
    line:
      block[2] !== undefined
        ? (lines.rows?.[+block[2]] ?? lines.line)
        : lines.line,
  };
}

/** Issues of an assembled plan in the model's terms: into the section plan's rows, into a part's
 * ops with the line, or for a finish naming the row to send again. */
export function wordPartIssues(
  issues: WordPlanDiagnostics,
  assembly: Pick<WordPartsAssembly, "entries" | "deleted">,
  focus: { kind: "plan" } | { kind: "part"; row: number } | { kind: "finish" },
  titleOf: (row: number) => string,
): WordPlanDiagnostics {
  return issues.map((issue) => {
    const { origin, path, line } = locate(issue.path, assembly);
    const message = issue.message.replace(
      WORD_PLAN_PATH_IN_TEXT,
      (found) => locate(found, assembly).path,
    );
    if (focus.kind === "part" && (!origin || origin.row === focus.row))
      return {
        ...issue,
        path,
        message: line === undefined ? message : `Line ${line}: ${message}`,
      };
    if (focus.kind === "plan" && (!origin || !("op" in origin)))
      return { ...issue, path, message };
    if (!origin)
      return {
        ...issue,
        message: `The section plan and its parts: ${message}`,
      };
    const part = "op" in origin;
    const where = part
      ? `, at ${path}${line === undefined ? "" : ` line ${line}`}`
      : "";
    const resend = part
      ? `Send row ${origin.row + 1} again with write_document_section.`
      : "Send the section plan again with this row fixed.";
    return {
      ...issue,
      path: "",
      message: `${wordPartRowName(origin.row, titleOf(origin.row))}${where}: ${message} ${resend}`,
    };
  });
}

/** One section draft per request, cleared with the read session's drafts. */
export class WordPartsDraftStore {
  private draft?: WordPartsDraft;

  clear(): void {
    this.draft = undefined;
  }

  get current(): WordPartsDraft | undefined {
    return this.draft;
  }

  /** Rewrite rows with the same blocks keep their parts. */
  carried(plan: WordPartsPlan): Map<number, WordPartOp[]> {
    const previous = this.draft;
    const parts = new Map<number, WordPartOp[]>();
    if (previous)
      plan.rows.forEach((row, r) => {
        if (row.action !== "rewrite") return;
        const same = previous.plan.rows.findIndex(
          (old) =>
            old.action === "rewrite" && old.refs.join() === row.refs.join(),
        );
        const ops = same >= 0 ? previous.parts.get(same) : undefined;
        if (ops) parts.set(r, ops);
      });
    return parts;
  }

  open(plan: WordPartsPlan, readToken: string): WordPartsDraft {
    const previous = this.draft;
    this.draft = {
      id: previous?.id ?? globalThis.crypto.randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      readToken,
      plan,
      parts: this.carried(plan),
    };
    return this.draft;
  }

  write(draft: WordPartsDraft, row: number, ops: WordPartOp[]): void {
    draft.parts.set(row, ops);
    draft.revision++;
  }
}

export const wordUnwrittenRows = (draft: WordPartsDraft): number[] =>
  draft.plan.rows.flatMap((row, r) =>
    row.action === "rewrite" && !draft.parts.has(r) ? [r] : [],
  );

/** `changed`: rows the finish left out because they changed in Word while Erato wrote them. */
export function wordPartRows(
  draft: WordPartsDraft,
  snapshot: WordAuthoringSnapshot,
  {
    finished = false,
    changed,
  }: { finished?: boolean; changed?: ReadonlySet<number> } = {},
) {
  const sections = wordCaptureSections(snapshot);
  const index = wordBlockIndex(snapshot);
  return draft.plan.rows.map((row, r) => ({
    row: r + 1,
    action: row.action,
    // A renamed row is named by the heading it renames, so old and new read as a pair.
    title: row.title
      ? (wordBlockTitle(sections, index.get(row.refs[0])!) ?? "")
      : wordPartRowTitle(row, snapshot),
    ...(row.title ? { new_title: row.title } : {}),
    paragraphs: row.refs.length,
    status: changed?.has(r)
      ? "changed_in_word"
      : row.action === "keep"
        ? "kept"
        : row.action === "delete"
          ? "deleted"
          : draft.parts.has(r)
            ? "ready"
            : finished
              ? "not_written"
              : "waiting",
  }));
}

const refusal = (
  path: string,
  code: string,
  message: string,
  error = "Document parts rejected.",
): ClientToolExecutionResult => ({
  ok: false,
  error,
  validationErrors: [{ path, code, message }],
});

export type WordPartsFinish =
  | {
      ok: true;
      draft: WordPartsDraft;
      assembly: WordPartsAssembly;
      unwritten: number[];
    }
  | { ok: false; result: ClientToolExecutionResult };

/** Rows without a part are refused once; finishing again at the same revision leaves them as they
 * are and the card names them, so nothing announced disappears unnoticed. */
export function finishWordParts(
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
  store: WordPartsDraftStore,
): WordPartsFinish {
  const fail = (path: string, code: string, message: string) => ({
    ok: false as const,
    result: refusal(path, code, message, "Document plan finish rejected."),
  });
  if (
    !only(input, ["snapshot", "readToken", "draft_id", "revision", "finish"]) ||
    input.finish !== true
  )
    return fail(
      "",
      "finish-shape",
      "A finish contains snapshot, readToken, draft_id, revision and finish:true only.",
    );
  const draft = store.current;
  if (!draft)
    return fail(
      "/draft_id",
      "draft-revision",
      "This request has no section plan to finish. Send plan_document_sections and its parts first, or submit the change another way.",
    );
  if (input.draft_id !== draft.id || input.revision !== draft.revision)
    return fail(
      "/revision",
      "draft-revision",
      `Use the draft_id and revision of the latest section plan or part receipt; the revision is now ${draft.revision}.`,
    );
  const unwritten = wordUnwrittenRows(draft);
  const leaveUnwritten = draft.unwrittenRefusedAt === draft.revision;
  if (unwritten.length && !leaveUnwritten) {
    draft.unwrittenRefusedAt = draft.revision;
    const rows = unwritten.map((r) =>
      wordPartRowName(r, wordPartRowTitle(draft.plan.rows[r], snapshot)),
    );
    const more = rows.length - 3;
    const listed =
      more > 0
        ? `${rows.slice(0, 3).join(", ")} and ${more} more ${more === 1 ? "row" : "rows"}`
        : rows.join(" and ");
    const them = rows.length > 1 ? "them" : "it";
    return fail(
      "/finish",
      "rows-not-written",
      `${listed} ${rows.length > 1 ? "have" : "has"} no part yet. Write ${them} with write_document_section and finish again, or finish again at revision ${draft.revision} to leave ${them} unchanged; the card then says so.`,
    );
  }
  return {
    ok: true,
    draft,
    assembly: assembleWordParts(
      snapshot,
      draft.readToken,
      draft.plan,
      draft.parts,
    ),
    unwritten: leaveUnwritten ? unwritten : [],
  };
}

export function wordPartsFinishRejected(
  prepared: Extract<ClientToolExecutionResult, { ok: false }>,
  { draft, assembly }: Extract<WordPartsFinish, { ok: true }>,
  snapshot: WordAuthoringSnapshot,
): ClientToolExecutionResult {
  return {
    ...prepared,
    validationErrors: wordPartIssues(
      prepared.validationErrors?.length
        ? prepared.validationErrors
        : [{ path: "", code: "finish-rejected", message: prepared.error }],
      assembly,
      { kind: "finish" },
      (r) => wordPartRowTitle(draft.plan.rows[r], snapshot),
    ),
  };
}

/** Section plan rows (from 0) and the reordering left out of a change in parts. */
export interface WordPartsLeaveOut {
  rows: ReadonlySet<number>;
  structure: boolean;
}

/**
 * The section plan and parts with rows left out as they were: a rewrite or delete row keeps its
 * blocks. Leaving out the reordering puts every row back in document order and leaves out the
 * renames and the rows whose text joins blocks from different places (`wordPartsLayout`).
 */
export function wordPartsWithout(
  plan: WordPartsPlan,
  parts: ReadonlyMap<number, WordPartOp[]>,
  leaveOut: WordPartsLeaveOut,
  snapshot: WordAuthoringSnapshot,
): { plan: WordPartsPlan; parts: Map<number, WordPartOp[]> } {
  const index = wordBlockIndex(snapshot);
  const positions = plan.rows.map((row) =>
    row.refs.map((ref) => index.get(ref)!),
  );
  const merged = new Set(
    leaveOut.structure
      ? wordPartsLayout(
          plan.rows.map((row, r) => ({
            action: row.action,
            refs: positions[r],
          })),
        ).merged
      : [],
  );
  const rows = plan.rows.map(
    (row, r): WordPartRow =>
      leaveOut.rows.has(r) ||
      merged.has(r) ||
      (leaveOut.structure && row.title !== undefined)
        ? { action: "keep", refs: row.refs }
        : row,
  );
  if (!leaveOut.structure)
    return {
      plan: { ...plan, rows },
      parts: new Map([...parts].filter(([r]) => rows[r]?.action === "rewrite")),
    };
  const pieces: { row: WordPartRow; from: number; part?: WordPartOp[] }[] = [];
  rows.forEach((row, r) => {
    if (row.action === "rewrite") {
      pieces.push({ row, from: positions[r][0], part: parts.get(r) });
      return;
    }
    let run: string[] = [];
    let from = -1;
    row.refs.forEach((ref, k) => {
      const at = positions[r][k];
      if (run.length && at !== positions[r][k - 1] + 1) {
        pieces.push({ row: { ...row, refs: run }, from });
        run = [];
      }
      if (!run.length) from = at;
      run.push(ref);
    });
    if (run.length) pieces.push({ row: { ...row, refs: run }, from });
  });
  pieces.sort((a, b) => a.from - b.from);
  return {
    plan: { ...plan, rows: pieces.map((piece) => piece.row) },
    parts: new Map(
      pieces.flatMap((piece, k) =>
        piece.part ? [[k, piece.part] as const] : [],
      ),
    ),
  };
}

/** Rows the draft changes whose blocks the user or a co-author changed in Word since the capture;
 * changes the journal cannot place count for nothing, as Apply's live check guards those. */
export function wordPartsChangedInWord(
  draft: Pick<WordPartsDraft, "plan" | "parts">,
  snapshot: WordAuthoringSnapshot,
  capture: WordReadCapture | undefined,
): Set<number> {
  const changed = new Set<number>();
  const changes = wordWrittenChanges(snapshot, capture, "document");
  if (!changes) return changed;
  const hit = new Set(changes.blocks);
  const index = wordBlockIndex(snapshot);
  draft.plan.rows.forEach((row, r) => {
    const changes =
      row.action === "delete" ||
      row.title !== undefined ||
      (row.action === "rewrite" && draft.parts.has(r));
    if (changes && row.refs.some((ref) => hit.has(index.get(ref)!)))
      changed.add(r);
  });
  return changed;
}

/**
 * The draft a message's accepted section plan and parts staged, rebuilt from the stored calls as
 * the pane's store kept it, with the rows its accepted finish left out as changed in Word.
 * Undefined when a call does not parse against `snapshot`.
 */
export function wordPartsFromContent(
  content: readonly ContentPart[] | undefined,
  snapshot: WordAuthoringSnapshot,
): { draft: WordPartsDraft; changed: Set<number> } | undefined {
  const store = new WordPartsDraftStore();
  let draftId: string | undefined;
  let finished: unknown;
  for (const part of content ?? []) {
    if (part.content_type !== "tool_use" || !object(part.input)) continue;
    const result =
      object(part.output) && object(part.output.result)
        ? part.output.result
        : {};
    if (isAcceptedWordSectionPlan(part)) {
      const parsed = parseWordPartsPlan(part.input, snapshot);
      if ("issues" in parsed || typeof part.input.readToken !== "string")
        return undefined;
      draftId = result.draft_id as string;
      store.open(parsed.plan, part.input.readToken);
      finished = undefined;
    } else if (
      draftId &&
      store.current &&
      isAcceptedWordSectionPart(part, draftId)
    ) {
      const r = (result.row as number) - 1;
      const row = store.current.plan.rows[r] as WordPartRow | undefined;
      if (row?.action !== "rewrite" || part.input.row !== r + 1)
        return undefined;
      const parsed = parseWordPartOps(part.input.ops, r, row, snapshot);
      if ("issues" in parsed) return undefined;
      store.write(store.current, r, parsed.ops);
    } else if (store.current && isAcceptedWordPartsFinish(part))
      finished = result.rows;
  }
  const draft = store.current;
  if (!draft) return undefined;
  const changed = new Set<number>();
  if (Array.isArray(finished))
    finished.forEach((row: unknown, r) => {
      if (object(row) && row.status === "changed_in_word") changed.add(r);
    });
  return { draft, changed };
}
