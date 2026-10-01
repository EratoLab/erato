export const WORD_READ_TOOL = "read_document_blocks";
export const WORD_SUBMIT_PLAN_TOOL = "submit_document_plan";
export const WORD_SUBMIT_PLAN_ACTION = "word.apply_document_plan";
export const WORD_EDITS_FENCE = "erato-word-edits";
export const WORD_INSERT_FENCE = "erato-word-insert";
export const WORD_PLAN_FENCE = "erato-word-document-plan";

/** The action facets a Word request is sent under. */
export const WORD_ACTION_FACET_IDS: ReadonlySet<string> = new Set([
  "word_document_authoring",
  "word_document_review",
  "word_compose",
  "word_document_ooxml",
  "word_ooxml_experiment",
]);
