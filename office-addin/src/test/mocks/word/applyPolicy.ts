import type { WordWholeDocumentImport } from "../../../word/utils/wordApplyPolicy";

/**
 * Sets the deployment's whole-document import switch for Word for the web; suites about the import
 * itself rather than the per-host policy use "allowed". Returns the restore, so it can be returned
 * from beforeEach.
 */
export function setWordWebImport(value: WordWholeDocumentImport): () => void {
  const previous = window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
    ...previous,
    word_apply: {
      ...previous?.word_apply,
      web: { ...previous?.word_apply?.web, whole_document_import: value },
    },
  };
  return () => {
    if (previous === undefined) delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    else window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = previous;
  };
}

export const allowWordWebImport = () => setWordWebImport("allowed");
