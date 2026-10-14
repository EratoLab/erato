import type {
  WordApplyHost,
  WordWholeDocumentImport,
} from "../../../word/utils/wordApplyPolicy";

type HostSettings = NonNullable<
  NonNullable<Window["MS_OFFICE_ADDIN_DEFAULT_SETTINGS"]>["word_apply"]
>[WordApplyHost];

/** Merges deployment settings for one Word host. Returns the restore, so it can be returned from
 * beforeEach. */
function setWordHostPolicy(
  host: WordApplyHost,
  settings: HostSettings,
): () => void {
  const previous = window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
  window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = {
    ...previous,
    word_apply: {
      ...previous?.word_apply,
      [host]: { ...previous?.word_apply?.[host], ...settings },
    },
  };
  return () => {
    if (previous === undefined) delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
    else window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = previous;
  };
}

/** The deployment's whole-document import switch for Word for the web; suites about the import
 * itself rather than the per-host policy use "allowed". */
export const setWordWebImport = (value: WordWholeDocumentImport) =>
  setWordHostPolicy("web", { whole_document_import: value });

/** The deployment's in-place switch for one host, e.g. off for suites about the desktop import. */
export const setWordInPlace = (host: WordApplyHost, value: boolean) =>
  setWordHostPolicy(host, { in_place: value });

export const allowWordWebImport = () => setWordWebImport("allowed");
