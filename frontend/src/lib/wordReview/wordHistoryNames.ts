import { WORD_COMMENT_THREAD_FACET_ID } from "./wordCommentContext";

export const WORD_READ_TOOL = "read_document_blocks";
export const WORD_SUBMIT_PLAN_TOOL = "submit_document_plan";
/** A large change goes as a section plan, then one part per rewritten row, then a finishing
 * submit_document_plan call (ERMAIN-1293). */
export const WORD_PLAN_SECTIONS_TOOL = "plan_document_sections";
export const WORD_WRITE_SECTION_TOOL = "write_document_section";
export const WORD_SUBMIT_PLAN_ACTION = "word.apply_document_plan";
export const WORD_EDITS_FENCE = "erato-word-edits";
export const WORD_INSERT_FENCE = "erato-word-insert";
export const WORD_PLAN_FENCE = "erato-word-document-plan";
/** The card of a change in parts while Erato writes it; its content is the section plan's call id. */
export const WORD_PARTS_FENCE = "erato-word-document-parts";
export const WORD_REPLACE_FENCE = "erato-word-replace";

/** The action facets a Word request is sent under. */
export const WORD_ACTION_FACET_IDS: ReadonlySet<string> = new Set([
  "word_document_authoring",
  "word_document_review",
  "word_compose",
  "word_document_ooxml",
  "word_ooxml_experiment",
  "word_selection",
  WORD_COMMENT_THREAD_FACET_ID,
]);
