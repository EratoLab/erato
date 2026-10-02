import {
  normalizeWordDocumentPlan,
  parseWordDocumentPlan,
  MAX_WORD_SCOPE_BYTES,
  canonicalWordPlan,
  wordReadScope,
  WordTableCellSubmissionError,
} from "@erato/frontend/word-review";

import type {
  WordAuthoringSnapshot,
  WordDocumentPlan,
  WordPlanBlock,
  WordPlanEntry,
  WordSectionPlan,
  WordStoryChange,
} from "@erato/frontend/word-review";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every((k) => keys.includes(k));
const fail = (message: string): never => {
  throw new WordTableCellSubmissionError(
    "/scoped_edit",
    "outside-read-scope",
    message,
  );
};

/** Materialize a sparse change set. The caller never supplies keep entries or a
 * complete output document. Source ownership and all non-target keeps are host-owned. */
export function expandWordScopedSubmission(
  input: Record<string, unknown>,
  snapshot: WordAuthoringSnapshot,
): WordDocumentPlan {
  const scope = wordReadScope(snapshot, input.readToken);
  if (input.snapshot !== snapshot.token || scope?.kind !== "objects")
    return fail("Use an active object-scoped readToken from this request.");
  if (
    new TextEncoder().encode(JSON.stringify(input)).length >
    MAX_WORD_SCOPE_BYTES
  )
    return fail("Scoped submission exceeds 24 KiB.");
  const edit = input.scoped_edit;
  if (
    !only(input, ["snapshot", "readToken", "scoped_edit"]) ||
    !object(edit) ||
    !only(edit, ["body", "objects", "stories", "sections"]) ||
    !Object.keys(edit).length
  )
    return fail(
      "Expected scoped_edit with body, objects, stories and/or sections changes.",
    );
  for (const key of Object.keys(edit))
    if (!Array.isArray(edit[key]) || (edit[key] as unknown[]).length > 16)
      return fail("Each change collection must contain at most 16 changes.");
  const bodyRefs = new Set(
    scope.targets
      .filter((t) => t.bodyRef && !t.objectTarget)
      .map((t) => t.bodyRef!),
  );
  const storyIds = new Set(
    scope.targets
      .filter((t) => t.storyId && !t.objectTarget)
      .map((t) => t.storyId!),
  );
  const sectionIds = new Set(
    scope.targets.filter((t) => t.sectionId).map((t) => t.sectionId!),
  );
  const readableSources = new Set(
    scope.targets
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
  const anchors = new Set<string>();
  const stories: WordStoryChange[] = [];
  const sectionChanges = edit.sections as Record<string, unknown>[] | undefined;
  const validateReferences = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(validateReferences);
      return;
    }
    if (!object(v)) return;
    for (const [k, value] of Object.entries(v)) {
      if (
        k === "sourceRef" &&
        (typeof value !== "string" || !readableSources.has(value))
      )
        fail("A sourceRef outside the read scope cannot be reused.");
      if (
        k === "assetRef" &&
        !(snapshot.assets ?? []).some((a) => a.ref === value)
      )
        fail("Use a captured image asset.");
      validateReferences(value);
    }
  };
  const blocks = (value: unknown): WordPlanBlock[] => {
    if (!Array.isArray(value) || !value.length)
      return fail(
        "Replacement and insertion require nonempty blocks; use delete for removal.",
      );
    validateReferences(value);
    return value as WordPlanBlock[];
  };
  const take = (refs: unknown): string[] => {
    if (
      !Array.isArray(refs) ||
      !refs.length ||
      refs.some(
        (r) => typeof r !== "string" || !bodyRefs.has(r) || consumed.has(r),
      ) ||
      new Set(refs).size !== refs.length
    )
      return fail(
        "Each changed body source must be explicitly read and consumed once.",
      );
    const start = originalRefs.indexOf(refs[0]);
    if (refs.some((r, i) => originalRefs[start + i] !== r))
      return fail("A body change must use an ordered contiguous source range.");
    refs.forEach((r) => consumed.add(r));
    return refs;
  };
  for (const raw of (edit.body as unknown[] | undefined) ?? []) {
    if (
      !object(raw) ||
      !only(raw, ["operation", "source", "anchor", "blocks", "reason"])
    )
      return fail("Invalid body change.");
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
      return fail("Unknown body operation.");
    const insert = String(op).startsWith("insert-");
    const move = String(op).startsWith("move-");
    if (
      (insert && raw.source !== undefined) ||
      (!insert && !move && raw.anchor !== undefined) ||
      ((move || op === "delete") && raw.blocks !== undefined)
    )
      return fail("Unexpected arguments for this body operation.");
    const refs = insert ? [] : take(raw.source);
    if (op === "replace")
      replaced.set(refs[0], {
        kind: "replace",
        source: refs,
        blocks: blocks(raw.blocks),
      });
    else if (op === "delete") {
      if (
        typeof raw.reason !== "string" ||
        !raw.reason.trim() ||
        raw.reason.length > 1000
      )
        return fail("Deletion requires a bounded reason.");
      deleted.push({ source: refs, reason: raw.reason });
    } else {
      if (
        typeof raw.anchor !== "string" ||
        !bodyRefs.has(raw.anchor) ||
        refs.includes(raw.anchor)
      )
        return fail(
          "Read the exact insertion/destination anchor as well as the moved sources.",
        );
      anchors.add(raw.anchor);
      const slots = String(op).endsWith("before") ? before : after;
      const entries = slots.get(raw.anchor) ?? [];
      entries.push(
        move
          ? { kind: "keep", source: refs }
          : {
              kind: "insert",
              contextRefs: [raw.anchor],
              blocks: blocks(raw.blocks),
            },
      );
      slots.set(raw.anchor, entries);
    }
  }
  // Object edits retain their enclosing source fragment. Several disjoint
  // selected objects in one fragment become a single native-edit block.
  const native = new Map<
    string,
    { bodyRef?: string; storyId?: string; edits: unknown[] }
  >();
  const seenObjects = new Set<string>();
  for (const raw of (edit.objects as unknown[] | undefined) ?? []) {
    if (
      !object(raw) ||
      !only(raw, ["ref", "edit"]) ||
      typeof raw.ref !== "string" ||
      !object(raw.edit)
    )
      return fail("Object change requires ref and edit.");
    const target = scope.targets.find(
      (t) => t.ref === raw.ref && t.objectTarget,
    );
    if (
      !target ||
      seenObjects.has(target.ref) ||
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
        "Read each exact object and change it once; kind and target are host-owned.",
      );
    seenObjects.add(target.ref);
    validateReferences(raw.edit);
    const source = target.bodyRef ?? `story_${target.storyId}`;
    const group = native.get(source) ?? {
      bodyRef: target.bodyRef,
      storyId: target.storyId,
      edits: [],
    };
    group.edits.push({
      ...raw.edit,
      kind: target.kind,
      target: target.objectTarget,
    });
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
    const block = {
      id: newId(),
      type: "native-edit",
      text: "",
      sourceRef,
      edits: group.edits,
    } as WordPlanBlock;
    if (group.bodyRef) {
      if (consumed.has(group.bodyRef))
        return fail("Object and body changes overlap.");
      consumed.add(group.bodyRef);
      replaced.set(group.bodyRef, {
        kind: "replace",
        source: [group.bodyRef],
        blocks: [block],
      });
    } else {
      const story = snapshot.stories?.find((s) => s.id === group.storyId);
      if (!story) return fail("Story no longer exists.");
      stories.push({
        kind: "upsert",
        type: story.type,
        id: story.id,
        blocks: [block],
      });
    }
  }
  for (const anchor of anchors)
    if (consumed.has(anchor))
      return fail(
        "An insertion/destination anchor cannot also be replaced, deleted or moved in this submission.",
      );
  for (const raw of (edit.stories as unknown[] | undefined) ?? []) {
    if (
      !object(raw) ||
      typeof raw.id !== "string" ||
      stories.some((s) => s.id === raw.id)
    )
      return fail("Story changes must be unique.");
    const existing = snapshot.stories?.find((s) => s.id === raw.id);
    if (existing && (!storyIds.has(existing.id) || raw.type !== existing.type))
      return fail(
        "Read the complete selected story before replacing or deleting it.",
      );
    if (!existing && (raw.kind !== "upsert" || !snapshot.fullDocument))
      return fail("New stories require a full internal capture and upsert.");
    if (raw.anchor !== undefined) {
      if (
        !object(raw.anchor) ||
        typeof raw.anchor.block !== "string" ||
        !bodyRefs.has(raw.anchor.block) ||
        consumed.has(raw.anchor.block)
      )
        return fail("Read and retain a note/comment's destination anchor.");
    } else if (!existing && !["header", "footer"].includes(String(raw.type)))
      return fail("A new note/comment requires a read body anchor.");
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
        "A new header/footer requires an explicitly read section association.",
      );
    validateReferences(raw.blocks);
    stories.push(raw as unknown as WordStoryChange);
  }
  let sections: WordSectionPlan[] | undefined;
  if (sectionChanges?.length) {
    if (!snapshot.fullDocument)
      return fail("Sections require a full internal capture.");
    sections = (snapshot.sections ?? []).map((s) => ({
      id: s.id,
      source: s.id,
      ...(s.afterBlock ? { after: s.afterBlock } : {}),
    }));
    const seen = new Set<string>();
    for (const raw of sectionChanges) {
      if (
        !object(raw) ||
        !only(raw, ["id", "delete", "after", "layout", "headers", "footers"]) ||
        typeof raw.id !== "string" ||
        seen.has(raw.id)
      )
        return fail("Invalid or duplicate section change.");
      seen.add(raw.id);
      const i = sections.findIndex((s) => s.id === raw.id);
      if (i >= 0 && !sectionIds.has(raw.id))
        return fail("Read a section before changing it.");
      if (
        i < 0 &&
        (raw.delete !== undefined ||
          (typeof raw.after !== "string" && raw.after !== null))
      )
        return fail("New sections require a read body boundary.");
      if (
        raw.after !== undefined &&
        raw.after !== null &&
        (typeof raw.after !== "string" ||
          !bodyRefs.has(raw.after) ||
          consumed.has(raw.after))
      )
        return fail("Read and retain the destination section boundary.");
      for (const [key, type] of [
        ["headers", "header"],
        ["footers", "footer"],
      ] as const) {
        if (raw[key] !== undefined && !object(raw[key]))
          return fail("Invalid section association.");
        for (const id of Object.values(
          (raw[key] as object | undefined) ?? {},
        )) {
          if (
            id !== null &&
            !stories.some(
              (s) => s.id === id && s.type === type && s.kind === "upsert",
            ) &&
            !scope.targets.some(
              (t) => t.storyId === id && !t.objectTarget && t.kind === type,
            )
          )
            return fail(
              "Read the header/footer before assigning it to a section.",
            );
        }
      }
      if (raw.delete === true) {
        if (!only(raw, ["id", "delete"]) || i < 0 || sections.length === 1)
          return fail("Cannot remove the only section.");
        const neighbor = sections[i + 1] ?? sections[i - 1];
        if (!sectionIds.has(neighbor.id))
          return fail("Read both sections affected by removing a boundary.");
        sections.splice(i, 1);
        if (i === sections.length) delete sections[i - 1].after;
      } else {
        if (raw.delete !== undefined)
          return fail("delete must be true or omitted.");
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
            return fail("Read the containing section before splitting it.");
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
  const entries: WordPlanEntry[] = [];
  for (const ref of originalRefs) {
    entries.push(...(before.get(ref) ?? []));
    const replacement = replaced.get(ref);
    if (replacement) entries.push(replacement);
    else if (!consumed.has(ref)) entries.push({ kind: "keep", source: [ref] });
    entries.push(...(after.get(ref) ?? []));
  }
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
  const parsed = parseWordDocumentPlan(JSON.stringify(value));
  if (!parsed)
    return fail("The scoped change does not satisfy the document contract.");
  const plan = normalizeWordDocumentPlan(parsed, snapshot);
  if (scope.plans.size >= 3 && !scope.plans.has(canonicalWordPlan(plan)))
    return fail("Scoped proposal budget exhausted.");
  scope.plans.add(canonicalWordPlan(plan));
  return plan;
}
