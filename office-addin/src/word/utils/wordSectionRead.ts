import {
  wordBlockIndex,
  wordCaptureSections,
  wordOutlineKib,
  wordOutlineTitle,
  wordSectionExtent,
} from "./wordDocumentOutline";
import { wordReadRefusedByIssue } from "./wordReadAccess";
import {
  WORD_READ_PAGE_BYTES,
  wordReadFragments,
  wordReadJsonBytes,
  wordReadPageStarts,
  wordReadRecord,
} from "./wordReadFragments";

import type { WordCaptureSections } from "./wordDocumentOutline";
import type { ClientToolExecutionResult } from "@erato/frontend/library";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const reference = (v: unknown): v is string =>
  typeof v === "string" && !!v && v.length <= 256;

interface PageItem {
  block: number;
  part: number;
  value: unknown;
  bytes: number;
}

function failure(
  path: string,
  code: string,
  message: string,
): ClientToolExecutionResult {
  return {
    ok: false,
    error: message,
    validationErrors: [{ path, code, message }],
  };
}

/** Whole blocks in their read form; a block larger than a page comes in the complete read's parts. */
function sectionItems(
  sections: WordCaptureSections,
  from: number,
  to: number,
): PageItem[] {
  const items: PageItem[] = [];
  for (let block = from; block < to; block++) {
    if (2 + sections.bytes[block] <= WORD_READ_PAGE_BYTES) {
      items.push({
        block,
        part: 0,
        value: sections.readable[block],
        bytes: sections.bytes[block],
      });
      continue;
    }
    for (const fragment of wordReadFragments(
      wordReadRecord(sections.readable[block]),
    ))
      items.push({
        block,
        part: fragment.part,
        value: fragment,
        bytes: wordReadJsonBytes(fragment),
      });
  }
  return items;
}

/** Stateless: the capture, the section and the page start travel in the cursor, so readers of one
 * capture never interfere and the session keeps nothing. */
function encodeCursor(binding: unknown[]): string {
  return btoa(JSON.stringify(binding))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return undefined;
  }
}

/** The blocks a section:{ref, throughRef?} read covers, or undefined for refs this capture lacks. */
export function wordSectionReadExtent(
  snapshot: WordAuthoringSnapshot,
  ref: unknown,
  throughRef: unknown,
): { kind: "extent"; from: number; to: number } | undefined {
  const index = wordBlockIndex(snapshot);
  const start = reference(ref) ? index.get(ref) : undefined;
  if (start === undefined) return undefined;
  if (throughRef === undefined) {
    const { from, to } = wordSectionExtent(
      wordCaptureSections(snapshot),
      start,
    );
    return { kind: "extent", from, to };
  }
  const through = reference(throughRef) ? index.get(throughRef) : undefined;
  return through === undefined || through < start
    ? undefined
    : { kind: "extent", from: start, to: through + 1 };
}

/** section:{ref, throughRef?, cursor?}: a section of the capture in pages of whole blocks. Always
 * read-only: no read token, no write scope, no change to the capture's write state. */
export function readWordSection(
  snapshot: WordAuthoringSnapshot,
  input: Record<string, unknown>,
): ClientToolExecutionResult {
  if (snapshot.revoked || snapshot.used)
    return failure(
      "/snapshot",
      snapshot.used ? "snapshot-used" : "snapshot-revoked",
      "This document capture has been used or revoked. A new request with the document included is required.",
    );
  if (snapshot.issue && wordReadRefusedByIssue(snapshot, "read-only"))
    return failure(
      "/snapshot",
      snapshot.issue,
      `This document capture cannot be read: ${snapshot.issue}.`,
    );
  if (
    input.snapshot !== snapshot.token ||
    input.documentIdentity !== snapshot.identity
  )
    return failure(
      "/snapshot",
      "snapshot-mismatch",
      "Use this request's exact snapshot and documentIdentity.",
    );
  const section = input.section;
  if (
    Object.keys(input).some(
      (k) => !["snapshot", "documentIdentity", "section"].includes(k),
    ) ||
    !object(section) ||
    Object.keys(section).some(
      (k) => !["ref", "throughRef", "cursor"].includes(k),
    ) ||
    !reference(section.ref) ||
    (section.throughRef !== undefined && !reference(section.throughRef)) ||
    (section.cursor !== undefined &&
      section.cursor !== null &&
      (typeof section.cursor !== "string" || section.cursor.length > 1024))
  )
    return failure(
      "/section",
      "read-arguments",
      "Expected snapshot, documentIdentity and section:{ref, throughRef?, cursor?}; no other arguments are supported.",
    );
  const index = wordBlockIndex(snapshot);
  const start = index.get(section.ref);
  if (start === undefined)
    return failure(
      "/section/ref",
      "section-reference",
      "section.ref must be a block ref of this capture, such as a ref from the outline.",
    );
  const through =
    section.throughRef === undefined
      ? undefined
      : index.get(section.throughRef);
  if (section.throughRef !== undefined && (through ?? -1) < start)
    return failure(
      "/section/throughRef",
      "section-range",
      "section.throughRef must be a block ref of this capture at or after section.ref.",
    );
  const sections = wordCaptureSections(snapshot);
  const extent =
    through === undefined
      ? wordSectionExtent(sections, start)
      : { from: start, to: through + 1 };
  const items = sectionItems(sections, extent.from, extent.to);
  const starts = wordReadPageStarts(items.map((item) => item.bytes));
  const binding = (page: number) =>
    encodeCursor([
      snapshot.token,
      section.ref,
      section.throughRef ?? null,
      page,
      items[starts[page]].block,
      items[starts[page]].part,
    ]);
  let page = 0;
  if (section.cursor) {
    const decoded = decodeCursor(section.cursor);
    page =
      Array.isArray(decoded) && typeof decoded[3] === "number"
        ? decoded[3]
        : -1;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page >= starts.length ||
      binding(page) !== section.cursor
    )
      return failure(
        "/section/cursor",
        "read-cursor",
        `Use a nextCursor from a read of this section in this capture, or restart it with ${JSON.stringify({ ref: section.ref, ...(section.throughRef !== undefined ? { throughRef: section.throughRef } : {}) })}.`,
      );
  }
  const entry = "entry" in extent ? extent.entry : undefined;
  const holder = sections.entryOf[extent.from];
  const blocks = snapshot.blocks.slice(extent.from, extent.to);
  return {
    ok: true,
    result: {
      snapshot: snapshot.token,
      documentIdentity: snapshot.identity,
      section: {
        ref: section.ref,
        ...(section.throughRef !== undefined
          ? { throughRef: section.throughRef }
          : {}),
        title:
          entry?.title ??
          wordOutlineTitle(blocks.find((b) => b.text.trim())?.text ?? ""),
        level:
          entry?.level ?? (holder >= 0 ? sections.outline[holder].level : 1),
        page: page + 1,
        pages: starts.length,
        kib: wordOutlineKib(sections.spanBytes(extent.from, extent.to)),
        paragraphs: sections.paragraphs(extent.from, extent.to),
      },
      blocks: items
        .slice(starts[page], starts[page + 1] ?? items.length)
        .map((item) => item.value),
      nextCursor: page + 1 < starts.length ? binding(page + 1) : null,
      complete: page + 1 === starts.length,
    },
  };
}
