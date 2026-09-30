import { cutToUtf8Bytes } from "./buildWordDocumentArgs";
import { WORD_AUTHORING_CONTRACT } from "./wordAuthoringContract";
import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import {
  readWordParagraphFormatting,
  readWordRunFormatting,
  wordChild,
  WORDPROCESSING_NS as W,
} from "./wordBlockFormatting";
import { wordImageAssetMetadata } from "./wordImageAssetData";
import {
  MAX_WORD_SCOPE_BYTES,
  MAX_WORD_SCOPE_TARGETS,
  MAX_WORD_SCOPES,
} from "./wordReadScope";
import { wordSourceDetails } from "./wordRichContent";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { WordScopeTarget } from "./wordReadScope";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

const encoder = new TextEncoder();
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const normalized = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const inventories = new WeakMap<
  WordAuthoringSnapshot,
  { fingerprint: string; targets: WordScopeTarget[] }
>();
const attempts = new WeakMap<WordAuthoringSnapshot, Map<string, number>>();
const snippet = (s: string) => ({
  text: cutToUtf8Bytes(s, 256),
  truncated: encoder.encode(s).length > 256,
});

/** The inventory and capability registry contain no Office.js dependencies. */
export function wordTargetInventory(
  snapshot: WordAuthoringSnapshot,
): WordScopeTarget[] {
  const cached = inventories.get(snapshot);
  if (cached?.fingerprint === snapshot.fingerprint) return cached.targets;
  const targets: WordScopeTarget[] = [];
  const children = (
    parent: WordScopeTarget,
    objects: Record<string, unknown>[] = [],
  ) => {
    for (const item of objects) {
      // Tables use their containing block/story as the preservation boundary.
      if (item.kind === "table") continue;
      if (typeof item.target !== "string" || typeof item.kind !== "string")
        continue;
      targets.push({
        ...parent,
        ref: `${parent.ref}__${item.target}`,
        kind: item.kind,
        text: [
          item.text,
          item.title,
          item.tag,
          item.name,
          item.alt,
          item.instruction,
        ]
          .filter((v) => typeof v === "string")
          .join(" "),
        objectTarget: item.target,
        objectRef: typeof item.ref === "string" ? item.ref : undefined,
        detail: item,
      });
    }
  };
  for (const block of snapshot.blocks) {
    const parent: WordScopeTarget = {
      ref: block.ref,
      kind:
        block.content && block.nativeKind === "table" ? "table" : block.type,
      text: block.text,
      bodyRef: block.ref,
      detail: { ...wordReadableSourceBlock(block) },
    };
    targets.push(parent);
    children(parent, block.objects);
  }
  if (snapshot.fullDocument) {
    for (const story of snapshot.stories ?? []) {
      const { xml, part: _part, nativeId, ...metadata } = story;
      const root = new DOMParser().parseFromString(xml, "application/xml");
      const paragraphs = Array.from(root.getElementsByTagNameNS(W, "p")).map(
        (p) => ({
          text: Array.from(p.getElementsByTagNameNS(W, "t"))
            .map((t) => t.textContent)
            .join(""),
          format: readWordParagraphFormatting(wordChild(p, "pPr")),
          runs: Array.from(p.getElementsByTagNameNS(W, "r")).map((r) => ({
            text: Array.from(r.getElementsByTagNameNS(W, "t"))
              .map((t) => t.textContent)
              .join(""),
            ...readWordRunFormatting(wordChild(r, "rPr")),
          })),
        }),
      );
      const anchors =
        nativeId === undefined
          ? []
          : snapshot.blocks
              .filter((b) => {
                const source = new DOMParser().parseFromString(
                  b.xml,
                  "application/xml",
                );
                return Array.from(
                  source.getElementsByTagNameNS(W, `${story.type}Reference`),
                ).some((r) => r.getAttributeNS(W, "id") === nativeId);
              })
              .map((b) => ({ ref: b.ref, text: b.text }));
      const detail = wordSourceDetails(xml, `story_${story.id}`);
      const parent: WordScopeTarget = {
        ref: `story_${story.id}`,
        kind: story.type,
        text: story.text,
        storyId: story.id,
        detail: { ...metadata, ...detail, paragraphs, anchors },
      };
      targets.push(parent);
      children(parent, detail.objects);
    }
    for (const section of snapshot.sections ?? []) {
      const { xml: _xml, ...detail } = section;
      targets.push({
        ref: section.id,
        kind: "section",
        text: section.id,
        sectionId: section.id,
        detail,
      });
    }
  }
  inventories.set(snapshot, { fingerprint: snapshot.fingerprint, targets });
  return targets;
}

export function readWordTargets(
  snapshot: WordAuthoringSnapshot,
  input: Record<string, unknown>,
): ClientToolExecutionResult {
  const fail = (code: string, message: string): ClientToolExecutionResult => ({
    ok: false,
    error: message,
    validationErrors: [{ path: "/target", code, message }],
  });
  if (snapshot.revoked || snapshot.used || snapshot.issue)
    return fail("snapshot-unavailable", "Use an active, available capture.");
  if (
    input.snapshot !== snapshot.token ||
    input.documentIdentity !== snapshot.identity
  )
    return fail(
      "snapshot-mismatch",
      "Use this request's exact snapshot and documentIdentity.",
    );
  const query = input.target;
  if (
    Object.keys(input).some(
      (k) => !["snapshot", "documentIdentity", "target"].includes(k),
    ) ||
    !object(query) ||
    Object.keys(query).some(
      (k) =>
        ![
          "kind",
          "text",
          "nearbyText",
          "ref",
          "refs",
          "throughRef",
          "offset",
        ].includes(k),
    ) ||
    ["kind", "text", "nearbyText", "ref", "throughRef"].some(
      (k) =>
        query[k] !== undefined &&
        (typeof query[k] !== "string" ||
          !normalized(query[k]) ||
          query[k].length > 256),
    ) ||
    (query.offset !== undefined &&
      (typeof query.offset !== "number" ||
        !Number.isSafeInteger(query.offset) ||
        query.offset < 0)) ||
    (query.refs !== undefined &&
      (!Array.isArray(query.refs) ||
        !query.refs.length ||
        query.refs.length > MAX_WORD_SCOPE_TARGETS ||
        query.refs.some((r) => typeof r !== "string" || r.length > 256) ||
        new Set(query.refs).size !== query.refs.length)) ||
    (query.refs !== undefined &&
      Object.keys(query).some((k) => k !== "refs")) ||
    !["kind", "text", "ref", "refs"].some((k) => query[k] !== undefined) ||
    (query.throughRef !== undefined && !query.ref)
  )
    return fail(
      "target-arguments",
      "Search by kind/text/nearbyText, select exact ref(s), or read a body range with ref and throughRef. offset pages search candidates.",
    );
  const inventory = wordTargetInventory(snapshot);
  let matches = inventory.filter((t) => {
    const position = snapshot.blocks.findIndex((b) => b.ref === t.bodyRef);
    const nearby =
      position < 0
        ? ""
        : `${snapshot.blocks[position - 1]?.text ?? ""}\n${snapshot.blocks[position + 1]?.text ?? ""}`;
    return (
      (query.kind === undefined || t.kind === query.kind) &&
      (query.ref === undefined || t.ref === query.ref) &&
      (query.refs === undefined || (query.refs as string[]).includes(t.ref)) &&
      (query.text === undefined ||
        normalized(t.text).includes(normalized(query.text as string))) &&
      (query.nearbyText === undefined ||
        normalized(nearby).includes(normalized(query.nearbyText as string)))
    );
  });
  let explicit = Array.isArray(query.refs);
  if (explicit && matches.length !== (query.refs as string[]).length)
    return fail(
      "target-reference",
      "At least one selected reference is absent from this snapshot.",
    );
  if (query.throughRef !== undefined) {
    const start =
      matches.length === 1 && !matches[0].objectTarget
        ? snapshot.blocks.findIndex((b) => b.ref === matches[0].bodyRef)
        : -1;
    const end = snapshot.blocks.findIndex((b) => b.ref === query.throughRef);
    if (start < 0 || end < start || end - start >= MAX_WORD_SCOPE_TARGETS)
      return fail(
        "target-range",
        "Select an ordered body range of at most 16 blocks.",
      );
    const refs = new Set(
      snapshot.blocks.slice(start, end + 1).map((b) => b.ref),
    );
    matches = inventory.filter(
      (t) => !t.objectTarget && t.bodyRef && refs.has(t.bodyRef),
    );
    explicit = true;
  }
  const offset = query.offset ?? 0;
  if (offset && offset >= matches.length)
    return fail(
      "target-offset",
      "offset must refer to an existing candidate page.",
    );
  const base = {
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
    scope: "objects",
    totalMatches: matches.length,
    candidates: matches.slice(offset, offset + 5).map((t) => {
      const i = snapshot.blocks.findIndex((b) => b.ref === t.bodyRef);
      return {
        ref: t.ref,
        kind: t.kind,
        text: snippet(t.text),
        before: snippet(snapshot.blocks[i - 1]?.text ?? ""),
        after: snippet(i < 0 ? "" : (snapshot.blocks[i + 1]?.text ?? "")),
      };
    }),
    nextOffset: offset + 5 < matches.length ? offset + 5 : null,
  };
  if (!matches.length || (!explicit && matches.length !== 1)) {
    const counts = attempts.get(snapshot) ?? new Map<string, number>();
    const key = JSON.stringify(query);
    const count = (counts.get(key) ?? 0) + 1;
    if (counts.size < 64 || counts.has(key)) counts.set(key, count);
    attempts.set(snapshot, counts);
    return {
      ok: true,
      result: {
        ...base,
        status: matches.length ? "ambiguous" : "not-found",
        repeatedQuery: count > 1,
        recovery:
          "No write authorized. Select a returned reference, change the search constraint, or ask for clarification; repeating the same query cannot reveal a new target.",
      },
    };
  }
  // Scope includes exact target data plus bounded identifying neighbors. Neighbors
  // and references mentioned in properties are context, never implicit write grants.
  const context = {
    targets: matches.map(({ detail, ...t }) => ({ ...t, content: detail })),
    styles: snapshot.styles,
    assets: (snapshot.assets ?? []).map(wordImageAssetMetadata),
    sectionsUsingTargets: (snapshot.sections ?? [])
      .filter((s) =>
        matches.some(
          (t) =>
            t.storyId &&
            [...Object.values(s.headers), ...Object.values(s.footers)].includes(
              t.storyId,
            ),
        ),
      )
      .map(({ xml: _xml, ...s }) => s),
  };
  if (encoder.encode(JSON.stringify(context)).length > MAX_WORD_SCOPE_BYTES)
    return {
      ok: true,
      result: {
        ...base,
        status: "unsupported",
        reason: "scope-context-limit",
        fallback: "narrow-target-or-complete-read",
        maxContextBytes: MAX_WORD_SCOPE_BYTES,
      },
    };
  snapshot.readScopes ??= new Map();
  if (snapshot.readScopes.size >= MAX_WORD_SCOPES)
    return fail(
      "scope-limit",
      "Scoped read limit reached; use a fresh request or complete read.",
    );
  const readToken = globalThis.crypto.randomUUID();
  snapshot.readScopes.set(readToken, {
    kind: "objects",
    snapshot: snapshot.token,
    identity: snapshot.identity,
    fingerprint: snapshot.fingerprint,
    targets: matches,
    plans: new Set(),
  });
  return {
    ok: true,
    result: {
      ...base,
      status: "ready",
      readToken,
      ...context,
      contract: WORD_AUTHORING_CONTRACT,
      maxContextBytes: MAX_WORD_SCOPE_BYTES,
      fullDocument: !!snapshot.fullDocument,
    },
  };
}
