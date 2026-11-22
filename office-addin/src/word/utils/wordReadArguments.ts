import {
  WORD_REPLAY_KEPT_KEY,
  WORD_REPLAY_NOTE_KEY,
} from "@erato/frontend/word-review";

import {
  wordBlockIndex,
  wordDocumentOutline,
  wordDocumentOutlineText,
} from "./wordDocumentOutline";
import { WORD_SECTION_KEYS, WORD_SECTION_READ_KEYS } from "./wordSectionRead";
import { WORD_TABLE_CELL_READ_KEYS } from "./wordTableCellRead";
import { WORD_TARGET_READ_KEYS } from "./wordTargetRead";

import type { WordReadOutcome } from "./wordReadFreshness";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** The backend keeps 512 characters of each validation message (client_tools.rs). */
const MAX_ISSUE_CHARS = 512;
const MAX_NAMED_FIELDS = 8;
const MAX_FIELD_NAME_CHARS = 64;

export const WORD_PLAIN_READ_KEYS: readonly string[] = ["snapshot", "cursor"];

type ReadForm = "plain" | "section" | "target" | "table_cell";
const FORM_KEYS: Record<ReadForm, readonly string[]> = {
  plain: WORD_PLAIN_READ_KEYS,
  section: WORD_SECTION_READ_KEYS,
  target: WORD_TARGET_READ_KEYS,
  table_cell: WORD_TABLE_CELL_READ_KEYS,
};

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The form executeRead dispatches on. */
const readForm = (args: unknown): ReadForm =>
  !object(args)
    ? "plain"
    : "section" in args
      ? "section"
      : "target" in args
        ? "target"
        : "table_cell" in args
          ? "table_cell"
          : "plain";

/** Whether the refusal's correct call would be the complete read, which then has to be available. */
export const wordRefusalOffersPlainRead = (args: unknown) =>
  readForm(args) === "plain";

function unexpectedFields(args: Record<string, unknown>): string[] {
  const allowed = FORM_KEYS[readForm(args)];
  const fields = Object.keys(args).filter((key) => !allowed.includes(key));
  if ("section" in args && object(args.section))
    fields.push(
      ...Object.keys(args.section)
        .filter((key) => !WORD_SECTION_KEYS.includes(key))
        .map((key) => `section.${key}`),
    );
  return fields;
}

function named(fields: readonly string[]): string {
  const shown = fields
    .filter((field) => field.length <= MAX_FIELD_NAME_CHARS)
    .slice(0, MAX_NAMED_FIELDS);
  const more = fields.length - shown.length;
  return [...shown, ...(more ? [`${more} more`] : [])].join(", ");
}

function firstSectionRef(snapshot: WordAuthoringSnapshot): string | undefined {
  return wordDocumentOutline(snapshot)[0]?.ref ?? snapshot.blocks[0]?.ref;
}

function sectionCall(snapshot: WordAuthoringSnapshot, ref: string) {
  return {
    snapshot: snapshot.token,
    documentIdentity: snapshot.identity,
    section: { ref },
  };
}

/** Refs are positions in the capture they were read from, so after a plan has added or removed
 * paragraphs an earlier snapshot's ref can name another part of this one. */
function namesEarlierRefs(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
): boolean {
  const form = readForm(args);
  return (
    object(args) &&
    form !== "plain" &&
    typeof args.snapshot === "string" &&
    args.snapshot !== snapshot.token &&
    /"(ref|refs|throughRef|sourceRef)":/.test(JSON.stringify(args[form]) ?? "")
  );
}

const EARLIER_REFS =
  "Refs from an earlier snapshot can name other parts now; take them from this request's outline.";

/** One read this capture accepts now: the complete read when the caller found it available,
 * otherwise a section read of the part the call named or of the outline's first part. */
function exampleRead(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
  plainAvailable: boolean,
): Record<string, unknown> {
  const section = object(args) && object(args.section) ? args.section : null;
  const index = wordBlockIndex(snapshot);
  const ref =
    typeof section?.ref === "string" &&
    index.has(section.ref) &&
    !namesEarlierRefs(snapshot, args)
      ? section.ref
      : firstSectionRef(snapshot);
  if ((plainAvailable && !section) || !ref)
    return { snapshot: snapshot.token, cursor: null };
  return sectionCall(snapshot, ref);
}

/** What fixes the call: a whole call for plain and section reads; for target and table_cell reads,
 * whose selectors only the model knows, this request's snapshot and documentIdentity. Each form
 * fits the backend's bound, since a cut value would be copied as it is. */
function fix(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
  plainAvailable: boolean,
): string {
  const form = readForm(args);
  const lead = namesEarlierRefs(snapshot, args) ? `${EARLIER_REFS} ` : "";
  const fitting = (whole: string, short: string) =>
    lead.length + whole.length <= MAX_ISSUE_CHARS
      ? `${lead}${whole}`
      : `${lead}${short}`;
  if (form === "target" || form === "table_cell")
    return fitting(
      `This request's snapshot and documentIdentity: ${JSON.stringify({ snapshot: snapshot.token, documentIdentity: snapshot.identity })}`,
      `This request's snapshot: ${JSON.stringify(snapshot.token)}; send it with this request's documentIdentity, the current document identity.`,
    );
  const example = exampleRead(snapshot, args, plainAvailable);
  return fitting(
    `A correct call: ${JSON.stringify(example)}`,
    `A correct call sends this request's snapshot and documentIdentity with ${JSON.stringify({ section: example.section })}.`,
  );
}

/**
 * A refusal of read arguments that says what to send instead: the fields the form does not take,
 * whether the arguments were a replay record, the reader's own reason, and what fixes the call.
 * The fix is an issue of its own, so the backend's bound on the first one never cuts it, and the
 * replay of earlier turns keeps only the first.
 */
export function wordReadArgumentsRefusal(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
  options: {
    plainAvailable: boolean;
    replayRecord: boolean;
    issue: { path: string; code: string; message: string };
  },
): WordReadOutcome {
  const { issue } = options;
  const unexpected = (object(args) ? unexpectedFields(args) : []).filter(
    (field) =>
      !options.replayRecord ||
      ![WORD_REPLAY_NOTE_KEY, WORD_REPLAY_KEPT_KEY].includes(field),
  );
  const plainUnavailable =
    readForm(args) === "plain" &&
    issue.code === "read-arguments" &&
    !options.plainAvailable;
  const message = [
    options.replayRecord
      ? "These arguments are a replay record of an earlier call (omitted_from_replay, kept), not a call. Send a read's own arguments."
      : "",
    unexpected.length
      ? `Unexpected ${unexpected.length === 1 ? "field" : "fields"}: ${named(unexpected)}.`
      : "",
    plainUnavailable
      ? "The complete read is unavailable for this request; read the parts it needs with section:{ref}."
      : issue.message,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    result: {
      ok: false,
      error: message,
      validationErrors: [
        { path: issue.path, code: issue.code, message },
        {
          path: "",
          code: issue.code,
          message: fix(snapshot, args, options.plainAvailable),
        },
      ],
    },
  };
}

const NEXT_STEPS =
  "Read the sections the request needs with section:{ref} using a ref from this outline (a heading's part includes its subsections), as exampleCall does, and repeat it with section.cursor set to nextCursor until complete=true. Use target, target.queries or table_cell only for what you edit, and submit scoped_edit or table_cell changes. No document changes were made.";
const FALLBACK_STEPS =
  "Read the sections the request needs with section:{ref} pages from the Outline, following nextCursor; use target, target.queries or table_cell only for what you edit, and submit scoped_edit or table_cell changes. No document changes were made.";

/**
 * A plain read the complete read is unavailable for, because the capture is too large or the
 * request's model budget is too small, answers with the outline its section reads go by and a
 * ready section call, so the model meets the rule when it applies. The outline keeps the
 * heading_outline budget, well under a read page.
 */
export function wordCompleteReadUnavailable(
  snapshot: WordAuthoringSnapshot,
  reason: string,
): WordReadOutcome {
  const lead = `${
    snapshot.completeReadIssue
      ? "This document is too large for a complete read"
      : "The complete read is unavailable within this request's model budget"
  }, so whole-document plans and repairs are unavailable.`;
  const outline = wordDocumentOutlineText(snapshot);
  const ref = firstSectionRef(snapshot);
  if (!outline || !ref) {
    const error = `${lead} ${FALLBACK_STEPS}`;
    return {
      result: {
        ok: false,
        error,
        validationErrors: [{ path: "/snapshot", code: reason, message: error }],
      },
    };
  }
  return {
    scope: { kind: "document" },
    result: {
      ok: true,
      result: {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        completeRead: "unavailable",
        reason,
        complete: false,
        next: `${lead} ${NEXT_STEPS}`,
        outline,
        exampleCall: sectionCall(snapshot, ref),
      },
    },
  };
}
