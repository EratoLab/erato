import {
  wordBlockIndex,
  wordDocumentOutline,
  wordDocumentOutlineText,
} from "./wordDocumentOutline";

import type { WordReadAccess } from "./wordReadAccess";
import type { WordReadOutcome } from "./wordReadFreshness";
import type { WordAuthoringSnapshot } from "@erato/frontend/word-review";

/** The backend's form of an earlier turn's call (replay_policy.rs) before ERMAIN-1274. */
const REPLAY_NOTE_KEY = "omitted_from_replay";
const REPLAY_KEPT_KEY = "kept";
/** The backend keeps 512 characters of each validation message (client_tools.rs). */
const MAX_ISSUE_CHARS = 512;
const MAX_NAMED_FIELDS = 8;
const MAX_FIELD_NAME_CHARS = 64;

type ReadForm = "plain" | "section" | "target" | "table_cell";
const FORM_FIELDS: Record<ReadForm, readonly string[]> = {
  plain: ["snapshot", "cursor"],
  section: ["snapshot", "documentIdentity", "section"],
  target: ["snapshot", "documentIdentity", "target", "include"],
  table_cell: ["snapshot", "documentIdentity", "table_cell"],
};
const SECTION_FIELDS = ["ref", "throughRef", "cursor"];

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** The form executeRead dispatches on. */
const readForm = (args: Record<string, unknown>): ReadForm =>
  "section" in args
    ? "section"
    : "target" in args
      ? "target"
      : "table_cell" in args
        ? "table_cell"
        : "plain";

/**
 * A model that copies the form earlier calls replay in sends the read under `kept`. Running that
 * read gives the result it asked for, so only the wrapper is dropped (ERMAIN-1274, the ERMAIN-1194
 * rule); anything else beside the wrapper stays and is refused.
 */
export function wordReplayRecordRead(input: unknown): {
  call: unknown;
  replayRecord: boolean;
} {
  if (!object(input) || !(REPLAY_NOTE_KEY in input || REPLAY_KEPT_KEY in input))
    return { call: input, replayRecord: false };
  const wrapperOnly = Object.keys(input).every((key) =>
    [REPLAY_NOTE_KEY, REPLAY_KEPT_KEY, "status"].includes(key),
  );
  return {
    call: wrapperOnly && object(input.kept) ? input.kept : input,
    replayRecord: true,
  };
}

function unexpectedFields(args: Record<string, unknown>): string[] {
  const allowed = FORM_FIELDS[readForm(args)];
  const fields = Object.keys(args).filter((key) => !allowed.includes(key));
  if ("section" in args && object(args.section))
    fields.push(
      ...Object.keys(args.section)
        .filter((key) => !SECTION_FIELDS.includes(key))
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

/** One read this capture accepts now: the complete read while this access may page it, otherwise a
 * section read of the part the call named or of the outline's first part. */
function exampleRead(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
  access: WordReadAccess,
): Record<string, unknown> {
  const section = object(args) && object(args.section) ? args.section : null;
  const plain =
    access !== "read-only" && !snapshot.issue && !snapshot.completeReadIssue;
  const index = wordBlockIndex(snapshot);
  const ref =
    typeof section?.ref === "string" && index.has(section.ref)
      ? section.ref
      : firstSectionRef(snapshot);
  if ((plain && !section) || !ref)
    return { snapshot: snapshot.token, cursor: null };
  return sectionCall(snapshot, ref);
}

/**
 * A refusal of read arguments that says what to send instead: the fields the form does not take,
 * whether the arguments were a replay record, and one call that works for this capture. The call
 * has an issue of its own, so the backend's bound on the first one never cuts it.
 */
export function wordReadArgumentsRefusal(
  snapshot: WordAuthoringSnapshot,
  args: unknown,
  access: WordReadAccess,
  options: { replayRecord: boolean; expected: string; path: string },
): WordReadOutcome {
  const unexpected = (object(args) ? unexpectedFields(args) : []).filter(
    (field) =>
      !options.replayRecord ||
      ![REPLAY_NOTE_KEY, REPLAY_KEPT_KEY].includes(field),
  );
  const message = [
    options.replayRecord
      ? "These arguments are a replay record of an earlier call (omitted_from_replay, kept), not a call. Send a read's own arguments."
      : "",
    unexpected.length
      ? `Unexpected ${unexpected.length === 1 ? "field" : "fields"}: ${named(unexpected)}.`
      : "",
    options.expected,
  ]
    .filter(Boolean)
    .join(" ");
  const example = exampleRead(snapshot, args, access);
  const correct = `A correct call: ${JSON.stringify(example)}`;
  // Only a long documentIdentity makes it longer; a cut call would be copied as it is.
  const call =
    correct.length <= MAX_ISSUE_CHARS
      ? correct
      : `A correct call sends this request's snapshot and documentIdentity with ${JSON.stringify({ section: example.section })}.`;
  return {
    result: {
      ok: false,
      error: message,
      validationErrors: [
        { path: options.path, code: "read-arguments", message },
        { path: "", code: "read-arguments", message: call },
      ],
    },
  };
}

const TOO_LARGE_NEXT =
  "This document is too large for a complete read, so whole-document plans and repairs are unavailable. Read the sections the request needs with section:{ref} using a ref from this outline (a heading's part includes its subsections), as exampleCall does, and repeat it with section.cursor set to nextCursor until complete=true. Use target, target.queries or table_cell only for what you edit, and submit scoped_edit or table_cell changes. No document changes were made.";

/** A plain read of a capture too large for one answers with the outline its section reads go by and
 * a ready section call, so the model meets the rule when it applies. The outline keeps the
 * heading_outline budget, well under a read page. */
export function wordTooLargeOutlineRead(
  snapshot: WordAuthoringSnapshot,
): WordReadOutcome | undefined {
  const outline = wordDocumentOutlineText(snapshot);
  const ref = firstSectionRef(snapshot);
  if (!outline || !ref || !snapshot.completeReadIssue) return undefined;
  return {
    scope: { kind: "document" },
    result: {
      ok: true,
      result: {
        snapshot: snapshot.token,
        documentIdentity: snapshot.identity,
        completeRead: "unavailable",
        reason: snapshot.completeReadIssue,
        complete: false,
        next: TOO_LARGE_NEXT,
        outline,
        exampleCall: sectionCall(snapshot, ref),
      },
    },
  };
}
