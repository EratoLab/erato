import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  MAX_WORD_SCOPE_BYTES,
  canonicalWordPlan,
  wordReadScope,
  wordSourceReadRefs,
  WordTableCellSubmissionError,
} from "@erato/frontend/word-review";

import {
  MAX_WORD_SCOPED_CHANGES,
  MAX_WORD_SCOPED_SOURCES,
  WORD_FULL_PLAN_RULE,
  WORD_SCOPED_SIZE,
  WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN,
} from "./wordAuthoringContract";
import { wordTargetInventory } from "./wordTargetRead";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanDiagnostics,
  WordPlanEntry,
  WordScopeTarget,
  WordSectionPlan,
  WordStoryChange,
} from "@erato/frontend/word-review";

export const WORD_SCOPED_TOKEN_MESSAGE =
  "Use an active readToken from this request: a target read's token or the final token of a complete read.";

/** Carries every diagnostic of the expanded plan, not only the first. */
export class WordScopedSubmissionError extends WordTableCellSubmissionError {
  constructor(
    path: string,
    code: string,
    message: string,
    readonly issues?: WordPlanDiagnostics,
  ) {
    super(path, code, message);
  }
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
/** A change the model can correct without reading again. */
const fail = (path: string, message: string): never => {
  throw new WordScopedSubmissionError(path, "scoped-shape", message);
};
/** Only a token, ref, anchor, object, story or section the read did not return
 * needs a new read; its code makes the model read again. */
const unread = (path: string, message: string): never => {
  throw new WordScopedSubmissionError(path, "outside-read-scope", message);
};

/** The sparse change an entry, deletion, story or section of the expanded plan came from. Object
 * edits on one source share a native-edit block, so `edits` lists the object change of each edit. */
export type WordScopedOrigin =
  | { collection: "body"; index: number; offset: number }
  | { collection: "stories" | "sections"; index: number }
  | { collection: "objects"; edits: number[] }
  | { kept: string; noun: "block" | "section" };

export interface WordScopedOrigins {
  entries: WordScopedOrigin[];
  /** The body change of each deletion. */
  deleted: number[];
  stories: WordScopedOrigin[];
  sections: WordScopedOrigin[];
}

export interface WordScopedExpansion {
  plan: WordDocumentPlan;
  origins: WordScopedOrigins;
}

const EXPANDED_PATH = /^\/(entries|deleted|stories|sections)\/(\d+)(\/.*)?$/;
const EXPANDED_PATH_IN_TEXT =
  /\/(?:entries|deleted|stories|sections)\/\d+(?:\/[\w-]+)*/g;

function scopedPath(
  path: string,
  origins: WordScopedOrigins,
): { path: string; kept?: string } {
  const match = EXPANDED_PATH.exec(path);
  if (!match)
    return {
      path: /^\/(entries|deleted|stories|sections|scope|version)$/.test(path)
        ? "/scoped_edit"
        : path,
    };
  const [, collection, n, rest = ""] = match;
  const origin: WordScopedOrigin | undefined =
    collection === "deleted"
      ? origins.deleted[+n] === undefined
        ? undefined
        : { collection: "body", index: origins.deleted[+n], offset: 0 }
      : origins[collection as "entries" | "stories" | "sections"][+n];
  if (!origin) return { path: "/scoped_edit" };
  if ("kept" in origin)
    return { path: "/scoped_edit", kept: `${origin.noun} ${origin.kept}` };
  if (origin.collection === "objects") {
    const edit = /^\/blocks\/0\/edits(?:\/(\d+)(\/.*)?)?$/.exec(rest);
    if (!edit) return { path: `/scoped_edit/objects/${origin.edits[0]}` };
    const change =
      edit[1] === undefined
        ? origin.edits.length === 1
          ? origin.edits[0]
          : undefined
        : origin.edits[+edit[1]];
    if (change === undefined) return { path: "/scoped_edit/objects" };
    const field = edit[2] ?? "";
    // kind and target come from the object's ref, never from the model's edit.
    return {
      path: `/scoped_edit/objects/${change}${
        /^\/(kind|target)(\/|$)/.test(field) ? "/ref" : `/edit${field}`
      }`,
    };
  }
  const base = `/scoped_edit/${origin.collection}/${origin.index}`;
  if (origin.collection === "body") {
    const blocks = /^\/blocks\/(\d+)(\/.*)?$/.exec(rest);
    if (blocks)
      return {
        path: `${base}/blocks/${+blocks[1] - origin.offset}${blocks[2] ?? ""}`,
      };
    if (rest.startsWith("/contextRefs")) return { path: `${base}/anchor` };
    if (rest === "/kind") return { path: `${base}/operation` };
    return { path: /^\/(source|reason)(\/|$)/.test(rest) ? base + rest : base };
  }
  if (origin.collection === "sections")
    return { path: base + (rest.startsWith("/source") ? "/id" : rest) };
  return { path: base + rest };
}

/** Diagnostics of an expanded plan, pointed at the sparse change the model sent. */
export function wordScopedIssues(
  issues: WordPlanDiagnostics,
  origins: WordScopedOrigins,
): WordPlanDiagnostics {
  return issues.map((issue) => {
    const { path, kept } = scopedPath(issue.path, origins);
    const message = issue.message.replace(EXPANDED_PATH_IN_TEXT, (found) => {
      const mapped = scopedPath(found, origins);
      return mapped.kept ? `unchanged ${mapped.kept}` : mapped.path;
    });
    return {
      ...issue,
      path,
      message: kept ? `Unchanged ${kept}: ${message}` : message,
    };
  });
}

/** The final token of a finished complete read covers everything that read returned. */
function completeReadTargets(
  snapshot: WordAuthoringSnapshot,
  token: unknown,
): WordScopeTarget[] | undefined {
  return typeof token === "string" &&
    token === snapshot.readToken &&
    !snapshot.revoked &&
    !snapshot.used &&
    !snapshot.issue &&
    !snapshot.completeReadIssue &&
    wordSourceReadRefs(snapshot).every((ref) => snapshot.read.has(ref))
    ? wordTargetInventory(snapshot)
    : undefined;
}

/** Materialize a sparse change set. The caller never supplies keep entries or a
 * complete output document. Source ownership and all non-target keeps are host-owned. */
export function expandWordScopedSubmission(
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
): WordScopedExpansion {
  const read = wordReadScope(snapshot, input.readToken);
  const scope = read?.kind === "objects" ? read : undefined;
  const targets =
    scope?.targets ??
    (read ? undefined : completeReadTargets(snapshot, input.readToken));
  if (input.snapshot !== snapshot.token || !targets)
    return unread("/readToken", WORD_SCOPED_TOKEN_MESSAGE);
  if (
    new TextEncoder().encode(JSON.stringify(input)).length >
    MAX_WORD_SCOPE_BYTES
  )
    return fail(
      "/scoped_edit",
      `Scoped submission exceeds ${WORD_SCOPED_SIZE}. ${
        snapshot.completeReadIssue
          ? WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN
          : `${WORD_FULL_PLAN_RULE} A full plan needs a complete read.`
      }`,
    );
  const edit = input.scoped_edit;
  if (
    !only(input, ["snapshot", "readToken", "scoped_edit"]) ||
    !object(edit) ||
    !only(edit, ["body", "objects", "stories", "sections"]) ||
    !Object.keys(edit).length
  )
    return fail(
      "/scoped_edit",
      "Expected scoped_edit with body, objects, stories and/or sections changes.",
    );
  for (const key of Object.keys(edit))
    if (
      !Array.isArray(edit[key]) ||
      (edit[key] as unknown[]).length > MAX_WORD_SCOPED_CHANGES
    )
      return fail(
        `/scoped_edit/${key}`,
        `Each change collection must contain at most ${MAX_WORD_SCOPED_CHANGES} changes. A change's blocks have no count limit, so keep a long list or passage in one change.`,
      );
  const bodyRefs = new Set(
    targets.filter((t) => t.bodyRef && !t.objectTarget).map((t) => t.bodyRef!),
  );
  const storyIds = new Set(
    targets.filter((t) => t.storyId && !t.objectTarget).map((t) => t.storyId!),
  );
  const sectionIds = new Set(
    targets.filter((t) => t.sectionId).map((t) => t.sectionId!),
  );
  const readableSources = new Set(
    targets
      .flatMap((t) => [
        t.objectTarget ? undefined : t.bodyRef,
        !t.objectTarget && t.storyId ? `story_${t.storyId}` : undefined,
        t.objectRef,
        ...(
          (t.detail.objects as Record<string, unknown>[] | undefined) ?? []
        ).map((o) => (typeof o.ref === "string" ? o.ref : undefined)),
      ])
      .filter((v): v is string => !!v),
  );
  const originalRefs = snapshot.blocks.map((b) => b.ref);
  const replaced = new Map<string, WordPlanEntry>();
  const consumed = new Set<string>();
  const before = new Map<string, WordPlanEntry[]>();
  const after = new Map<string, WordPlanEntry[]>();
  const deleted: WordDocumentPlan["deleted"] = [];
  const deletedOrigins: number[] = [];
  /** Each anchor and the first body change that names it. */
  const anchors = new Map<string, number>();
  const stories: WordStoryChange[] = [];
  const storyOrigins: WordScopedOrigin[] = [];
  const entryOrigins = new Map<WordPlanEntry, WordScopedOrigin>();
  /** Where each consumed body ref was named, and whether the block stays (a move). */
  const consumedBy = new Map<string, { path: string; kept: boolean }>();
  const sectionChanges = edit.sections as Record<string, unknown>[] | undefined;
  const validateReferences = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => validateReferences(item, `${path}/${i}`));
      return;
    }
    if (!object(v)) return;
    for (const [k, value] of Object.entries(v)) {
      const at = `${path}/${k}`;
      if (k === "sourceRef" && typeof value !== "string")
        fail(at, "sourceRef must be a returned source ref.");
      if (
        k === "sourceRef" &&
        typeof value === "string" &&
        !readableSources.has(value)
      )
        unread(at, "A sourceRef outside the read scope cannot be reused.");
      if (
        k === "assetRef" &&
        !(snapshot.assets ?? []).some((a) => a.ref === value)
      )
        fail(at, "Use a captured image asset.");
      validateReferences(value, at);
    }
  };
  const blocks = (value: unknown, path: string): WordPlanBlock[] => {
    if (!Array.isArray(value) || !value.length)
      return fail(
        path,
        "Replacement and insertion require nonempty blocks; use delete for removal.",
      );
    validateReferences(value, path);
    return value as WordPlanBlock[];
  };
  const take = (refs: unknown, path: string): string[] => {
    if (Array.isArray(refs) && refs.length > MAX_WORD_SCOPED_SOURCES)
      return fail(
        path,
        `A change may list at most ${MAX_WORD_SCOPED_SOURCES} source refs. Split a longer range into consecutive changes.`,
      );
    if (
      !Array.isArray(refs) ||
      !refs.length ||
      refs.some((r) => typeof r !== "string" || consumed.has(r)) ||
      new Set(refs).size !== refs.length
    )
      return fail(
        path,
        "Each changed body source must be explicitly read and consumed once.",
      );
    if (refs.some((r) => !bodyRefs.has(r as string)))
      return unread(
        path,
        "Each changed body source must be explicitly read and consumed once.",
      );
    const start = originalRefs.indexOf(refs[0]);
    if (refs.some((r, i) => originalRefs[start + i] !== r))
      return fail(
        path,
        "A body change must use an ordered contiguous source range.",
      );
    refs.forEach((r) => consumed.add(r));
    return refs;
  };
  for (const [index, raw] of (
    (edit.body as unknown[] | undefined) ?? []
  ).entries()) {
    const path = `/scoped_edit/body/${index}`;
    const origin: WordScopedOrigin = { collection: "body", index, offset: 0 };
    if (
      !object(raw) ||
      !only(raw, ["operation", "source", "anchor", "blocks", "reason"])
    )
      return fail(path, "Invalid body change.");
    const op = raw.operation;
    if (
      ![
        "replace",
        "delete",
        "insert-before",
        "insert-after",
        "move-before",
        "move-after",
      ].includes(String(op))
    )
      return fail(`${path}/operation`, "Unknown body operation.");
    const insert = String(op).startsWith("insert-");
    const move = String(op).startsWith("move-");
    if (
      (insert && raw.source !== undefined) ||
      (!insert && !move && raw.anchor !== undefined) ||
      ((move || op === "delete") && raw.blocks !== undefined)
    )
      return fail(path, "Unexpected arguments for this body operation.");
    const refs = insert ? [] : take(raw.source, `${path}/source`);
    refs.forEach((ref, k) =>
      consumedBy.set(ref, { path: `${path}/source/${k}`, kept: move }),
    );
    if (op === "replace") {
      const entry: WordPlanEntry = {
        kind: "replace",
        source: refs,
        blocks: blocks(raw.blocks, `${path}/blocks`),
      };
      entryOrigins.set(entry, origin);
      replaced.set(refs[0], entry);
    } else if (op === "delete") {
      if (
        typeof raw.reason !== "string" ||
        !raw.reason.trim() ||
        raw.reason.length > 1000
      )
        return fail(`${path}/reason`, "Deletion requires a bounded reason.");
      deleted.push({ source: refs, reason: raw.reason });
      deletedOrigins.push(index);
    } else {
      if (typeof raw.anchor !== "string" || refs.includes(raw.anchor))
        return fail(
          `${path}/anchor`,
          "Read the exact insertion/destination anchor as well as the moved sources.",
        );
      if (!bodyRefs.has(raw.anchor))
        return unread(
          `${path}/anchor`,
          "Read the exact insertion/destination anchor as well as the moved sources.",
        );
      if (!anchors.has(raw.anchor)) anchors.set(raw.anchor, index);
      const slots = String(op).endsWith("before") ? before : after;
      const entries = slots.get(raw.anchor) ?? [];
      const entry: WordPlanEntry = move
        ? { kind: "keep", source: refs }
        : {
            kind: "insert",
            contextRefs: [raw.anchor],
            blocks: blocks(raw.blocks, `${path}/blocks`),
          };
      entryOrigins.set(entry, origin);
      entries.push(entry);
      slots.set(raw.anchor, entries);
    }
  }
  // Object edits retain their enclosing source fragment. Several disjoint
  // selected objects in one fragment become a single native-edit block.
  const native = new Map<
    string,
    {
      bodyRef?: string;
      storyId?: string;
      edits: unknown[];
      changes: number[];
    }
  >();
  const seenObjects = new Set<string>();
  for (const [index, raw] of (
    (edit.objects as unknown[] | undefined) ?? []
  ).entries()) {
    const path = `/scoped_edit/objects/${index}`;
    if (
      !object(raw) ||
      !only(raw, ["ref", "edit"]) ||
      typeof raw.ref !== "string" ||
      !object(raw.edit)
    )
      return fail(path, "Object change requires ref and edit.");
    const target = targets.find((t) => t.ref === raw.ref && t.objectTarget);
    if (!target)
      return unread(
        `${path}/ref`,
        "Read each exact object and change it once; kind and target are host-owned.",
      );
    if (seenObjects.has(target.ref))
      return fail(
        `${path}/ref`,
        "Read each exact object and change it once; kind and target are host-owned.",
      );
    if (
      !only(raw.edit, [
        "operation",
        "instruction",
        "text",
        "locked",
        "name",
        "title",
        "tag",
        "lock",
        "appearance",
        "color",
        "children",
        "binding",
        "image",
        "drawing",
      ])
    )
      return fail(
        `${path}/edit`,
        "Read each exact object and change it once; kind and target are host-owned.",
      );
    seenObjects.add(target.ref);
    validateReferences(raw.edit, `${path}/edit`);
    const source = target.bodyRef ?? `story_${target.storyId}`;
    const group = native.get(source) ?? {
      bodyRef: target.bodyRef,
      storyId: target.storyId,
      edits: [],
      changes: [],
    };
    group.edits.push({
      ...raw.edit,
      kind: target.kind,
      target: target.objectTarget,
    });
    group.changes.push(index);
    native.set(source, group);
  }
  let sequence = 0;
  // IDs use a reserved collision-checked namespace only for host-generated blocks.
  const newId = () => {
    let id: string;
    do {
      id = `scoped_native_${++sequence}`;
    } while (JSON.stringify(edit).includes(`"${id}"`));
    return id;
  };
  for (const [sourceRef, group] of native) {
    const path = `/scoped_edit/objects/${group.changes[0]}`;
    const origin: WordScopedOrigin = {
      collection: "objects",
      edits: group.changes,
    };
    const block = {
      id: newId(),
      type: "native-edit",
      text: "",
      sourceRef,
      edits: group.edits,
    } as WordPlanBlock;
    if (group.bodyRef) {
      if (consumed.has(group.bodyRef))
        return fail(`${path}/ref`, "Object and body changes overlap.");
      consumed.add(group.bodyRef);
      consumedBy.set(group.bodyRef, { path: `${path}/ref`, kept: false });
      const entry: WordPlanEntry = {
        kind: "replace",
        source: [group.bodyRef],
        blocks: [block],
      };
      entryOrigins.set(entry, origin);
      replaced.set(group.bodyRef, entry);
    } else {
      const story = snapshot.stories?.find((s) => s.id === group.storyId);
      if (!story) return fail(`${path}/ref`, "Story no longer exists.");
      if (story.type === "comment")
        throw new WordTableCellSubmissionError(
          `${path}/ref`,
          "comment-story-route",
          "Objects inside comments are changed with the comment actions, not in document plans.",
        );
      stories.push({
        kind: "upsert",
        type: story.type,
        id: story.id,
        blocks: [block],
      });
      storyOrigins.push(origin);
    }
  }
  for (const [anchor, index] of anchors)
    if (consumed.has(anchor))
      return fail(
        `/scoped_edit/body/${index}/anchor`,
        "An insertion/destination anchor cannot also be replaced, deleted or moved in this submission.",
      );
  for (const [index, raw] of (
    (edit.stories as unknown[] | undefined) ?? []
  ).entries()) {
    const path = `/scoped_edit/stories/${index}`;
    if (object(raw) && raw.type === "comment")
      throw new WordTableCellSubmissionError(
        `${path}/type`,
        "comment-story-route",
        "Comments are changed with the comment actions, not in document plans. Remove this story change.",
      );
    if (
      !object(raw) ||
      typeof raw.id !== "string" ||
      stories.some((s) => s.id === raw.id)
    )
      return fail(
        object(raw) ? `${path}/id` : path,
        "Story changes must be unique.",
      );
    const existing = snapshot.stories?.find((s) => s.id === raw.id);
    if (existing && !storyIds.has(existing.id))
      return unread(
        `${path}/id`,
        "Read the complete selected story before replacing or deleting it.",
      );
    if (existing && raw.type !== existing.type)
      return fail(
        `${path}/type`,
        "Read the complete selected story before replacing or deleting it.",
      );
    if (!existing && (raw.kind !== "upsert" || !snapshot.fullDocument))
      return fail(
        `${path}/kind`,
        "New stories require a full internal capture and upsert.",
      );
    if (raw.anchor !== undefined) {
      if (
        !object(raw.anchor) ||
        typeof raw.anchor.block !== "string" ||
        consumed.has(raw.anchor.block)
      )
        return fail(
          `${path}/anchor`,
          "Read and retain a note/comment's destination anchor.",
        );
      if (!bodyRefs.has(raw.anchor.block))
        return unread(
          `${path}/anchor/block`,
          "Read and retain a note/comment's destination anchor.",
        );
    } else if (!existing && !["header", "footer"].includes(String(raw.type)))
      return fail(
        `${path}/anchor`,
        "A new note/comment requires a read body anchor.",
      );
    if (
      !existing &&
      ["header", "footer"].includes(String(raw.type)) &&
      !sectionChanges?.some(
        (s) =>
          object(s) &&
          sectionIds.has(String(s.id)) &&
          [s.headers, s.footers].some(
            (v) => object(v) && Object.values(v).includes(raw.id),
          ),
      )
    )
      return fail(
        path,
        "A new header/footer requires an explicitly read section association.",
      );
    validateReferences(raw.blocks, `${path}/blocks`);
    stories.push(raw as unknown as WordStoryChange);
    storyOrigins.push({ collection: "stories", index });
  }
  let sections: WordSectionPlan[] | undefined;
  /** Each changed section's id and its change. */
  const changedSections = new Map<string, number>();
  /** Sections whose end the model moved or removed. */
  const resectioned = new Set<string>();
  if (sectionChanges?.length) {
    if (!snapshot.fullDocument)
      return fail(
        "/scoped_edit/sections",
        "Sections require a full internal capture.",
      );
    sections = (snapshot.sections ?? []).map((s) => ({
      id: s.id,
      source: s.id,
      ...(s.afterBlock ? { after: s.afterBlock } : {}),
    }));
    const seen = new Set<string>();
    for (const [index, raw] of sectionChanges.entries()) {
      const path = `/scoped_edit/sections/${index}`;
      if (
        !object(raw) ||
        !only(raw, ["id", "delete", "after", "layout", "headers", "footers"]) ||
        typeof raw.id !== "string" ||
        seen.has(raw.id)
      )
        return fail(path, "Invalid or duplicate section change.");
      seen.add(raw.id);
      const i = sections.findIndex((s) => s.id === raw.id);
      if (i >= 0 && !sectionIds.has(raw.id))
        return unread(`${path}/id`, "Read a section before changing it.");
      if (
        i < 0 &&
        (raw.delete !== undefined ||
          (typeof raw.after !== "string" && raw.after !== null))
      )
        return fail(
          `${path}/after`,
          "New sections require a read body boundary.",
        );
      if (
        raw.after !== undefined &&
        raw.after !== null &&
        (typeof raw.after !== "string" || consumed.has(raw.after))
      )
        return fail(
          `${path}/after`,
          "Read and retain the destination section boundary.",
        );
      if (typeof raw.after === "string" && !bodyRefs.has(raw.after))
        return unread(
          `${path}/after`,
          "Read and retain the destination section boundary.",
        );
      for (const [key, type] of [
        ["headers", "header"],
        ["footers", "footer"],
      ] as const) {
        if (raw[key] !== undefined && !object(raw[key]))
          return fail(`${path}/${key}`, "Invalid section association.");
        for (const [name, id] of Object.entries(
          (raw[key] as object | undefined) ?? {},
        )) {
          if (
            id !== null &&
            !stories.some(
              (s) => s.id === id && s.type === type && s.kind === "upsert",
            ) &&
            !targets.some(
              (t) => t.storyId === id && !t.objectTarget && t.kind === type,
            )
          )
            return unread(
              `${path}/${key}/${name}`,
              "Read the header/footer before assigning it to a section.",
            );
        }
      }
      if (raw.after !== undefined || raw.delete === true)
        resectioned.add(raw.id);
      if (raw.delete === true) {
        if (!only(raw, ["id", "delete"]) || i < 0 || sections.length === 1)
          return fail(`${path}/delete`, "Cannot remove the only section.");
        const neighbor = sections[i + 1] ?? sections[i - 1];
        if (!sectionIds.has(neighbor.id))
          return unread(
            path,
            "Read both sections affected by removing a boundary.",
          );
        sections.splice(i, 1);
        if (i === sections.length) delete sections[i - 1].after;
      } else {
        if (raw.delete !== undefined)
          return fail(`${path}/delete`, "delete must be true or omitted.");
        changedSections.set(raw.id, index);
        const change = {
          ...(i >= 0 ? sections[i] : {}),
          ...raw,
        } as WordSectionPlan;
        if (raw.after === null) delete change.after;
        if (i >= 0) sections[i] = change;
        else {
          const end =
            raw.after === null
              ? originalRefs.length
              : originalRefs.indexOf(raw.after as string);
          const container =
            raw.after === null
              ? snapshot.sections?.at(-1)
              : sections.find(
                  (s) =>
                    s.after === undefined ||
                    originalRefs.indexOf(s.after) >= end,
                );
          if (!container || !sectionIds.has(container.id))
            return unread(
              `${path}/after`,
              "Read the containing section before splitting it.",
            );
          sections.push(change);
        }
      }
    }
    sections.sort(
      (a, b) =>
        (a.after === undefined
          ? originalRefs.length
          : originalRefs.indexOf(a.after)) -
        (b.after === undefined
          ? originalRefs.length
          : originalRefs.indexOf(b.after)),
    );
  }
  // The paragraph that ends a section carries its section break, so replacing or deleting it
  // drops the break unless the change also moves or removes that section's end.
  for (const block of snapshot.blocks) {
    const by = block.sectionBoundary ? consumedBy.get(block.ref) : undefined;
    if (!by || by.kept) continue;
    const section = snapshot.sections?.find((s) => s.afterBlock === block.ref);
    if (section && resectioned.has(section.id)) continue;
    return fail(
      by.path,
      `Block ${block.ref} ends ${section ? `section ${section.id}` : "a section"}; leave it out of this change${
        snapshot.fullDocument && section
          ? `, or add a sections change for ${section.id} (after: a read block you keep, or delete: true)`
          : ""
      }.`,
    );
  }
  const entries: WordPlanEntry[] = [];
  for (const ref of originalRefs) {
    entries.push(...(before.get(ref) ?? []));
    const replacement = replaced.get(ref);
    if (replacement) entries.push(replacement);
    else if (!consumed.has(ref)) entries.push({ kind: "keep", source: [ref] });
    entries.push(...(after.get(ref) ?? []));
  }
  const origins: WordScopedOrigins = {
    entries: entries.map(
      (entry) =>
        entryOrigins.get(entry) ?? {
          kept: entry.kind === "keep" ? entry.source[0] : "",
          noun: "block",
        },
    ),
    deleted: deletedOrigins,
    stories: storyOrigins,
    sections: (sections ?? []).map((s) => {
      const index = changedSections.get(s.id);
      return index === undefined
        ? { kept: s.id, noun: "section" }
        : { collection: "sections", index };
    }),
  };
  const value = {
    version: 1,
    snapshot: snapshot.token,
    readToken: input.readToken,
    scope: stories.length || sections ? "document" : "body",
    entries,
    deleted,
    ...(stories.length ? { stories } : {}),
    ...(sections ? { sections } : {}),
  };
  const parseIssues: WordPlanDiagnostics = [];
  const parsed = parseWordDocumentPlan(JSON.stringify(value), parseIssues);
  if (!parsed) {
    const issues = wordScopedIssues(parseIssues, origins);
    const [first] = issues;
    throw new WordScopedSubmissionError(
      first?.path ?? "/scoped_edit",
      first?.code ?? "scoped-shape",
      first?.message ??
        "The scoped change does not satisfy the document contract.",
      issues,
    );
  }
  const plan = normalizeWordDocumentPlan(parsed, snapshot);
  // After a complete read the expanded plan has a full plan's rights; the
  // backend's attempt budget still applies.
  if (!scope) return { plan, origins };
  if (scope.plans.size >= 3 && !scope.plans.has(canonicalWordPlan(plan)))
    return fail("/scoped_edit", "Scoped proposal budget exhausted.");
  scope.plans.add(canonicalWordPlan(plan));
  return { plan, origins };
}
