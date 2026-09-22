import { wordPlanError } from "./wordPlanDiagnostics";
import { resolveWordSource, wordSourceDetails } from "./wordRichContent";
import { parseWordBlock, wordBlockChildEntries } from "./wordRichPlan";
import { parseWordSections, parseWordStoryChanges } from "./wordStories";
import { WORD_FINGERPRINT_PREFIX } from "./wordXmlComparison";

import type {
  WordParagraphFormatting,
  WordRunFormatting,
} from "./wordBlockFormatting";
import type { WordImageAsset, WordImageAssetIssue } from "./wordImageAssets";
import type {
  WordFieldSpec,
  WordBookmarkSpec,
  WordContentControlSpec,
  WordNativeStructureEdit,
} from "./wordInlineStructures";
import type { WordImageSpec, WordDrawingSpec } from "./wordMediaContent";
import type { WordPlanDiagnostics } from "./wordPlanDiagnostics";
import type {
  WordStoryChange,
  WordSectionPlan,
  WordStorySource,
  WordSectionSource,
} from "./wordStories";
import type { WordTableBlock, WordTableContent } from "./wordTableContent";

/** Host-validated authoring data. Source ownership is independent of output order. */
export interface WordPlanRun extends WordRunFormatting {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}
interface WordBlockBase {
  id: string;
  text: string;
  runs?: WordPlanRun[];
  level?: number;
  styleRef?: string;
  list?: string;
  ordered?: boolean;
}
export type WordPlanBlock = WordBlockBase &
  (
    | {
        type: "paragraph" | "heading" | "list-item";
        format?: WordParagraphFormatting;
      }
    | WordTableBlock<WordPlanBlock>
    | { type: "image"; image: WordImageSpec }
    | { type: "drawing"; drawing: WordDrawingSpec }
    | { type: "field"; field: WordFieldSpec }
    | { type: "bookmark"; bookmark: WordBookmarkSpec<WordPlanBlock> }
    | {
        type: "content-control";
        control: WordContentControlSpec<WordPlanBlock>;
      }
    | {
        type: "native-edit";
        sourceRef: string;
        edits: WordNativeStructureEdit<WordPlanBlock>[];
      }
  );
export type WordPlanEntry =
  | { kind: "keep"; source: string[] }
  | { kind: "replace"; source: string[]; blocks: WordPlanBlock[] }
  | { kind: "insert"; contextRefs?: string[]; blocks: WordPlanBlock[] };
export interface WordDocumentPlan {
  version: 1;
  snapshot: string;
  readToken: string;
  scope: "body" | "document";
  entries: WordPlanEntry[];
  deleted: { source: string[]; reason: string }[];
  stories?: WordStoryChange[];
  sections?: WordSectionPlan[];
}
export interface WordSourceBlock {
  ref: string;
  text: string;
  type: "paragraph" | "heading" | "list-item" | "native";
  /** Native objects and anchored ranges travel intact, never through model text. */
  nativeKind?:
    | "table"
    | "image"
    | "field"
    | "content-control"
    | "anchored-content"
    | "section-break"
    | "rich-content";
  description?: string;
  /** A section's native properties stay in their original section order. */
  sectionBoundary?: boolean;
  /** Host-only navigation mapping; block references are not paragraph ordinals. */
  paragraphOrdinal?: number;
  level?: number;
  styleRef?: string;
  protected: boolean;
  ordered?: boolean;
  list?: string;
  runs?: WordPlanRun[];
  format?: WordParagraphFormatting;
  /** Typed inventory; source XML and binary assets remain on the host. */
  content?: WordTableContent<WordPlanBlock>;
  objects?: Record<string, unknown>[];
  /** Captured native XML is host-only, never returned by the read tool. */
  xml: string;
}
export interface WordAuthoringSnapshot {
  token: string;
  identity: string;
  ooxml: string;
  fingerprint: string;
  blocks: WordSourceBlock[];
  styles: { id: string; name: string; type?: string }[];
  issue?:
    | "unsupported"
    | "too-large"
    | "tracking"
    | "unavailable"
    | "budget-unavailable"
    | "model-budget";
  /** Fixed diagnostic codes, never document text or XML. */
  issueDetails?: string[];
  preservedStories?: string[];
  /** True only when all DOCX parts were read, including out-of-body stories. */
  fullDocument?: boolean;
  /** Host-only identity for full-file capture/apply/recovery. */
  documentUrl?: string;
  stories?: WordStorySource[];
  sections?: WordSectionSource[];
  assets?: WordImageAsset[];
  imageAssetIssues?: WordImageAssetIssue[];
  /** Fully delivered source references, owned by the read executor. */
  read: Set<string>;
  revoked: boolean;
  used: boolean;
  readToken?: string;
  ownerMessageId?: string;
}
export const MAX_PLAN_BYTES = 256 * 1024;
export const MAX_DOCUMENT_BLOCKS = 2000;
export const MAX_SOURCE_BYTES = 192 * 1024;

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((key) => allowed.includes(key));
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const refs = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= MAX_DOCUMENT_BLOCKS &&
  v.every(id);
export function parseWordDocumentPlan(
  content: string,
  issues?: WordPlanDiagnostics,
): WordDocumentPlan | null {
  const fail = (path: string, code: string, message: string) =>
    wordPlanError(issues, path, code, message);
  if (new TextEncoder().encode(content).length > MAX_PLAN_BYTES)
    return fail("", "too-large", "Plan exceeds the host's maxPlanBytes limit.");
  try {
    const v: unknown = JSON.parse(content);
    // Absence means no explicit deletions. Coverage validation still requires
    // every source exactly once; this never infers deletion of omitted sources.
    if (object(v) && v.deleted === undefined) v.deleted = [];
    if (
      !object(v) ||
      !keys(v, [
        "version",
        "snapshot",
        "readToken",
        "scope",
        "entries",
        "deleted",
        "stories",
        "sections",
      ]) ||
      v.version !== 1 ||
      !id(v.snapshot) ||
      !id(v.readToken) ||
      !["body", "document"].includes(String(v.scope)) ||
      !Array.isArray(v.entries) ||
      (v.entries.length === 0 &&
        (!Array.isArray(v.deleted) || v.deleted.length === 0)) ||
      v.entries.length > MAX_DOCUMENT_BLOCKS ||
      !Array.isArray(v.deleted) ||
      v.deleted.length > MAX_DOCUMENT_BLOCKS
    )
      return fail(
        "",
        "plan-envelope",
        "Expected version 1, snapshot, readToken, scope, entries and optional deleted/stories/sections. Unknown properties are not supported.",
      );
    if (
      v.scope === "body" &&
      (v.stories !== undefined || v.sections !== undefined)
    )
      return fail(
        "/scope",
        "document-scope",
        "Stories and sections require scope=document and a full-document capture.",
      );
    if (v.stories !== undefined) {
      const stories = parseWordStoryChanges(v.stories, parseWordBlock);
      if (!stories)
        return fail(
          "/stories",
          "story-shape",
          "Invalid story changes or nested blocks; use the story contract returned by the read tool.",
        );
      v.stories = stories;
    }
    if (v.sections !== undefined) {
      const sections = parseWordSections(v.sections);
      if (!sections)
        return fail(
          "/sections",
          "section-shape",
          "Invalid section list; each non-final section requires after and the final section omits it.",
        );
      v.sections = sections;
    }
    for (const [index, e] of v.entries.entries()) {
      const path = `/entries/${index}`;
      if (!object(e))
        return fail(
          path,
          "entry-shape",
          "Expected a keep, replace or insert object.",
        );
      if (e.kind === "keep") {
        if (!keys(e, ["kind", "source"]) || !refs(e.source))
          return fail(
            path,
            "keep-shape",
            "Keep requires a nonempty source array and no other properties.",
          );
      } else if (e.kind === "replace" || e.kind === "insert") {
        if (
          !keys(
            e,
            e.kind === "replace"
              ? ["kind", "source", "blocks"]
              : ["kind", "contextRefs", "blocks"],
          ) ||
          !Array.isArray(e.blocks) ||
          e.blocks.length === 0 ||
          e.blocks.length > MAX_DOCUMENT_BLOCKS
        )
          return fail(
            path,
            "entry-shape",
            "Replace requires source and blocks; insert requires blocks and optional contextRefs. Blocks must be nonempty.",
          );
        if (
          e.kind === "replace"
            ? !refs(e.source)
            : e.contextRefs !== undefined && !refs(e.contextRefs)
        )
          return fail(
            `${path}/${e.kind === "replace" ? "source" : "contextRefs"}`,
            "source-shape",
            "Expected a nonempty array of captured source references.",
          );
        const blocks = e.blocks.map((b, i) =>
          parseWordBlock(b, 0, issues, `${path}/blocks/${i}`),
        );
        if (blocks.some((b) => b === null)) return null;
        e.blocks = blocks;
      } else
        return fail(
          `${path}/kind`,
          "entry-kind",
          "Supported entry kinds: keep, replace, insert.",
        );
    }
    if (
      !v.deleted.every(
        (d) =>
          object(d) &&
          keys(d, ["source", "reason"]) &&
          refs(d.source) &&
          typeof d.reason === "string" &&
          d.reason.trim().length > 0 &&
          d.reason.length < 2000,
      )
    )
      return fail(
        "/deleted",
        "deletion-shape",
        "Each deletion requires nonempty source references and a nonempty reason shorter than 2000 characters.",
      );
    return v as unknown as WordDocumentPlan;
  } catch {
    return fail("", "invalid-json", "Expected one complete JSON plan object.");
  }
}

export type WordPlanIssue =
  | "no-capture"
  | "expired"
  | "unsupported"
  | "too-large"
  | "tracking"
  | "unavailable"
  | "model-budget"
  | "budget-unavailable"
  | "incomplete"
  | "protected-content"
  | "section-order"
  | "invalid";
export function validateWordDocumentPlan(
  plan: WordDocumentPlan,
  snapshot?: WordAuthoringSnapshot,
  issues?: WordPlanDiagnostics,
): WordPlanIssue | null {
  const fail = (
    issue: WordPlanIssue,
    path: string,
    code: string,
    message: string,
  ) => {
    wordPlanError(issues, path, code, message);
    return issue;
  };
  const reject = (path: string, code: string, message: string) => {
    wordPlanError(issues, path, code, message);
    return false;
  };
  if (!snapshot)
    return fail(
      "no-capture",
      "/snapshot",
      "no-capture",
      "No active capture; a new request with the document included is required.",
    );
  if (
    snapshot.fingerprint &&
    !snapshot.fingerprint.startsWith(WORD_FINGERPRINT_PREFIX)
  )
    return fail(
      "expired",
      "/snapshot",
      "expired",
      "The capture format has expired; a new document request is required.",
    );
  if (snapshot.revoked || snapshot.used || plan.snapshot !== snapshot.token)
    return fail(
      "expired",
      "/snapshot",
      "expired",
      "The snapshot token is mismatched, revoked or already used. Use the current request's active snapshot.",
    );
  if (snapshot.issue)
    return fail(
      snapshot.issue,
      "/snapshot",
      snapshot.issue,
      "The capture is unavailable; consult the read-tool result for its availability reason.",
    );
  if (plan.scope === "document" && !snapshot.fullDocument)
    return fail(
      "unavailable",
      "/scope",
      "document-scope",
      "scope=document requires a full-document capture.",
    );
  if (
    plan.scope === "body" &&
    (plan.stories !== undefined || plan.sections !== undefined)
  )
    return fail(
      "invalid",
      "/scope",
      "document-scope",
      "Stories and sections require scope=document.",
    );
  if (
    !snapshot.readToken ||
    plan.readToken !== snapshot.readToken ||
    wordSourceReadRefs(snapshot).some((ref) => !snapshot.read.has(ref))
  )
    return fail(
      "incomplete",
      "/readToken",
      "incomplete-read",
      "All snapshot pages must be read; readToken must match the completed read for this request.",
    );

  const sources = new Map(snapshot.blocks.map((b) => [b.ref, b]));
  const consumed = new Set<string>();
  const keptRefs = new Set(
    plan.entries.flatMap((entry) =>
      entry.kind === "keep" ? entry.source : [],
    ),
  );
  // An annotation target must resolve to exactly one body block. Story content
  // shares the output ID namespace, but cannot become a body annotation target.
  const outputIds = new Set(keptRefs);
  const bodyAnchors = new Map<string, { text: string; type: string }>();
  const bodyOrder = new Map<string, number>();
  const lists = new Map<string, boolean>();
  let outputCount = 0;
  let bodyPosition = 0;
  const detailsCache = new Map<string, ReturnType<typeof wordSourceDetails>>();
  const sourceDetails = (ref: string) => {
    const source = resolveWordSource(snapshot, ref);
    if (
      !source ||
      (!snapshot.fullDocument && source.part !== "/word/document.xml")
    )
      return undefined;
    if (!detailsCache.has(ref))
      detailsCache.set(ref, wordSourceDetails(source.xml, ref));
    return { ...source, ...detailsCache.get(ref)! };
  };
  const consume = (refs: string[], path: string) =>
    refs.every((ref, index) => {
      if (!sources.has(ref) || consumed.has(ref))
        return reject(
          `${path}/${index}`,
          "source-ownership",
          "Each body source must be captured and consumed exactly once by keep, replace or deleted.",
        );
      consumed.add(ref);
      return true;
    });
  const mediaSource = (
    spec: WordImageSpec | WordDrawingSpec,
    kind: "image" | "drawing",
  ) => {
    if (spec.sourceRef) {
      const source = sourceDetails(spec.sourceRef);
      if (!source || (source.kind !== undefined && source.kind !== kind))
        return false;
      const objects =
        source.objects?.filter((object) => object.kind === kind) ?? [];
      if (!objects[source.index ?? spec.sourceIndex ?? 0]) return false;
    }
    if (
      "assetRef" in spec &&
      spec.assetRef &&
      !snapshot.assets?.some((asset) => asset.ref === spec.assetRef)
    )
      return false;
    return true;
  };
  const validBlocks = (
    blocks: WordPlanBlock[],
    body: boolean,
    path: string,
  ): boolean => {
    const pending = blocks.map((block, i) => ({ block, path: `${path}/${i}` }));
    while (pending.length) {
      const { block, path: blockPath } = pending.shift()!;
      outputCount++;
      if (outputIds.has(block.id))
        return reject(
          `${blockPath}/id`,
          "duplicate-id",
          "Output IDs must be globally unique, including nested blocks, story blocks and kept source references.",
        );
      outputIds.add(block.id);
      if (body) bodyAnchors.set(block.id, block);
      if (
        block.styleRef &&
        !snapshot.styles.some(
          (style) =>
            style.id === block.styleRef &&
            (!style.type || style.type === "paragraph"),
        )
      )
        return reject(
          `${blockPath}/styleRef`,
          "paragraph-style",
          "styleRef must be a paragraph style ID returned by the read tool.",
        );
      if (
        block.type === "table" &&
        block.format?.styleRef &&
        !snapshot.styles.some(
          (style) =>
            style.id === block.format?.styleRef && style.type === "table",
        )
      )
        return reject(
          `${blockPath}/format/styleRef`,
          "table-style",
          "Table styleRef must be a table style ID returned by the read tool.",
        );
      if ("sourceRef" in block && block.sourceRef) {
        const source = sourceDetails(block.sourceRef);
        if (
          !source ||
          (block.type === "table" &&
            source.kind !== undefined &&
            source.kind !== "table")
        )
          return reject(
            `${blockPath}/sourceRef`,
            "source-reference",
            "sourceRef must resolve to a captured source of the correct object type.",
          );
        if (
          block.type === "table" &&
          !source.objects?.filter((object) => object.kind === "table")[
            source.index ?? 0
          ]
        )
          return reject(
            `${blockPath}/sourceRef`,
            "table-source",
            "sourceRef must identify a captured table.",
          );
      }
      if (block.type === "image" && !mediaSource(block.image, "image"))
        return reject(
          `${blockPath}/image`,
          "image-reference",
          "Image sourceRef and assetRef must resolve to captured image objects and attachments.",
        );
      if (block.type === "drawing" && !mediaSource(block.drawing, "drawing"))
        return reject(
          `${blockPath}/drawing`,
          "drawing-reference",
          "Drawing sourceRef must resolve to a captured drawing.",
        );
      if (block.type === "native-edit") {
        const source = sourceDetails(block.sourceRef);
        // Native-edit selectors are relative to the complete source block or
        // story. An object sourceRef is instead used by its typed block form.
        if (!source || source.kind !== undefined)
          return reject(
            `${blockPath}/sourceRef`,
            "native-source",
            "Native edits require a complete source block or story reference, not an object reference.",
          );
        const objects = source.objects ?? [];
        const targets = new Set<string>();
        for (const [editIndex, edit] of block.edits.entries()) {
          const key = edit.kind + ":" + edit.target;
          if (
            targets.has(key) ||
            !objects.some(
              (object) =>
                object.kind === edit.kind && object.target === edit.target,
            )
          )
            return reject(
              `${blockPath}/edits/${editIndex}/target`,
              "native-target",
              "Each native target must exist with the given kind in this source and may be edited only once.",
            );
          targets.add(key);
          if (
            edit.kind === "image" &&
            edit.image &&
            !mediaSource(edit.image, "image")
          )
            return reject(
              `${blockPath}/edits/${editIndex}/image`,
              "image-reference",
              "Replacement images must use captured object or attachment references.",
            );
          if (
            edit.kind === "drawing" &&
            edit.drawing &&
            !mediaSource(edit.drawing, "drawing")
          )
            return reject(
              `${blockPath}/edits/${editIndex}/drawing`,
              "drawing-reference",
              "Replacement drawings must use captured drawing references.",
            );
        }
      }
      if (block.type === "list-item" && block.list) {
        if (lists.has(block.list) && lists.get(block.list) !== block.ordered)
          return reject(
            `${blockPath}/ordered`,
            "list-consistency",
            "All items in one list group must use the same ordered value.",
          );
        lists.set(block.list, !!block.ordered);
      }
      pending.push(...wordBlockChildEntries(block, blockPath));
    }
    return true;
  };

  for (const [index, entry] of plan.entries.entries()) {
    const path = `/entries/${index}`;
    if (entry.kind !== "insert" && !consume(entry.source, `${path}/source`))
      return "invalid";
    if (
      entry.kind === "insert" &&
      entry.contextRefs?.some((ref) => !sources.has(ref))
    )
      return fail(
        "invalid",
        `${path}/contextRefs`,
        "context-reference",
        "contextRefs must identify captured body sources.",
      );
    if (entry.kind === "keep") {
      outputCount += entry.source.length;
      for (const ref of entry.source) {
        bodyAnchors.set(ref, sources.get(ref)!);
        bodyOrder.set(ref, bodyPosition++);
      }
    } else {
      if (!validBlocks(entry.blocks, true, `${path}/blocks`)) return "invalid";
      for (const block of entry.blocks) bodyOrder.set(block.id, bodyPosition++);
    }
  }
  const storyIds = new Set<string>();
  const availableStories = new Map(
    (snapshot.stories ?? []).map((story) => [story.id, story.type]),
  );
  for (const [index, story] of (plan.stories ?? []).entries()) {
    const path = `/stories/${index}`;
    if (storyIds.has(story.id))
      return fail(
        "invalid",
        `${path}/id`,
        "duplicate-story",
        "A story may be changed only once per plan.",
      );
    storyIds.add(story.id);
    const existing = snapshot.stories?.find((source) => source.id === story.id);
    if (
      (existing && existing.type !== story.type) ||
      (!existing && story.kind === "delete")
    )
      return fail(
        "invalid",
        path,
        "story-source",
        "An existing story must keep its type; delete requires an existing story ID.",
      );
    if (
      !existing &&
      story.kind === "upsert" &&
      !["header", "footer"].includes(story.type) &&
      !story.anchor
    )
      return fail(
        "invalid",
        `${path}/anchor`,
        "story-anchor",
        "New notes and comments require an anchor in the output body.",
      );
    if (story.anchor) {
      const target = bodyAnchors.get(story.anchor.block);
      if (!target)
        return fail(
          "invalid",
          `${path}/anchor/block`,
          "anchor-reference",
          "Anchor block must identify an output body block or kept body source.",
        );
      const start =
        story.anchor.start ??
        (story.type === "comment" ? 0 : target.text.length);
      const end =
        story.anchor.end ??
        (story.type === "comment" ? target.text.length : start);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < start ||
        (target.type !== "native-edit" && end > target.text.length) ||
        (story.type !== "comment" && end !== start)
      )
        return fail(
          "invalid",
          `${path}/anchor`,
          "anchor-range",
          "Anchor offsets must fit the target text in UTF-16 units; notes require a point, comments allow a range.",
        );
    }
    if (!validBlocks(story.blocks ?? [], false, `${path}/blocks`))
      return "invalid";
    if (story.kind === "delete") availableStories.delete(story.id);
    else availableStories.set(story.id, story.type);
  }
  if (outputCount > MAX_DOCUMENT_BLOCKS)
    return fail(
      "too-large",
      "/entries",
      "block-limit",
      "Output including nested and story blocks exceeds maxOutputBlocks.",
    );
  for (const [index, deletion] of plan.deleted.entries())
    if (!consume(deletion.source, `/deleted/${index}/source`)) return "invalid";
  if (consumed.size !== sources.size)
    return fail(
      "invalid",
      "/entries",
      "source-coverage",
      "Every captured body source must appear exactly once in keep, replace or deleted; omitted sources are not implicitly deleted.",
    );

  if (plan.sections) {
    if (!parseWordSections(plan.sections))
      return fail(
        "invalid",
        "/sections",
        "section-shape",
        "Invalid complete section list.",
      );
    let previous = -1;
    const oddEven = new Set<boolean>();
    for (const [index, section] of plan.sections.entries()) {
      const path = `/sections/${index}`;
      if (
        section.source &&
        !snapshot.sections?.some((source) => source.id === section.source)
      )
        return fail(
          "invalid",
          `${path}/source`,
          "section-source",
          "Section source must match a captured section ID.",
        );
      if (section.after) {
        const position = bodyOrder.get(section.after);
        if (position === undefined || position <= previous)
          return fail(
            "section-order",
            `${path}/after`,
            "section-order",
            "Section boundaries must reference top-level output blocks in strictly increasing output order.",
          );
        previous = position;
      }
      if (section.layout?.differentOddEvenPages !== undefined)
        oddEven.add(section.layout.differentOddEvenPages);
      for (const [kind, mapping] of [
        ["header", section.headers],
        ["footer", section.footers],
      ] as const)
        for (const ref of Object.values(mapping ?? {}))
          if (ref !== null && availableStories.get(ref) !== kind)
            return fail(
              "invalid",
              path,
              "section-story",
              "Header/footer references must resolve to existing or upserted stories of the matching type.",
            );
    }
    if (oddEven.size > 1)
      return fail(
        "invalid",
        "/sections",
        "section-layout",
        "differentOddEvenPages is document-wide and must agree across sections.",
      );
  } else {
    const sections = snapshot.blocks
      .filter((block) => block.sectionBoundary)
      .map((block) => block.ref);
    const outputSections = plan.entries.flatMap((entry) =>
      entry.kind === "keep"
        ? entry.source.filter((ref) => sources.get(ref)?.sectionBoundary)
        : [],
    );
    if (JSON.stringify(sections) !== JSON.stringify(outputSections))
      return fail(
        "section-order",
        "/entries",
        "section-order",
        "Without an explicit sections list, all existing section boundaries must be kept in their original order.",
      );
  }
  return null;
}

/** Body and story/layout source data share the same complete-read requirement. */
export function wordSourceReadRefs(snapshot: WordAuthoringSnapshot): string[] {
  return [
    ...snapshot.blocks.map((b) => b.ref),
    ...(snapshot.fullDocument
      ? (snapshot.stories ?? []).map((s) => `story_${s.id}`)
      : []),
    ...(snapshot.fullDocument && snapshot.sections?.length
      ? ["document_sections"]
      : []),
  ];
}

export function wordPlanOutput(
  plan: WordDocumentPlan,
  snapshot: WordAuthoringSnapshot,
): {
  key: string;
  block: WordPlanBlock | WordSourceBlock;
  source: string[];
  kind: WordPlanEntry["kind"];
}[] {
  const sources = new Map(snapshot.blocks.map((b) => [b.ref, b]));
  const output = plan.entries.flatMap<{
    key: string;
    block: WordPlanBlock | WordSourceBlock;
    source: string[];
    kind: WordPlanEntry["kind"];
  }>((e) =>
    e.kind === "keep"
      ? e.source.flatMap((ref) => {
          const b = sources.get(ref);
          return b
            ? [{ key: `source:${ref}`, block: b, source: [ref], kind: e.kind }]
            : [];
        })
      : e.blocks.map((b) => ({
          key: `output:${b.id}`,
          block: b,
          source: e.kind === "replace" ? e.source : (e.contextRefs ?? []),
          kind: e.kind,
        })),
  );
  // Word always retains a final paragraph. A clear-body plan explicitly deletes
  // the source; the host supplies the empty document, not nine empty replacements.
  return output.length
    ? output
    : [
        {
          key: "empty-document",
          block: { id: "empty-document", type: "paragraph", text: "" },
          source: [],
          kind: "insert",
        },
      ];
}
