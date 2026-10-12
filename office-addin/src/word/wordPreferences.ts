import {
  usePersistedState,
  type PersistedStateOptions,
} from "@erato/frontend/library";
import { useCallback } from "react";

// Device-local on purpose: Office.context.document.settings would persist into the .docx.
export const WORD_PREFERENCES_KEY = "erato.addin.word.preferences.v1";

export interface WordPreferences {
  includeDocumentByDefault?: boolean;
}

const NO_WORD_PREFERENCES: WordPreferences = {};

export const wordPreferencesPersistedOptions: PersistedStateOptions<WordPreferences> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const { includeDocumentByDefault } = value as Record<string, unknown>;
      return typeof includeDocumentByDefault === "boolean"
        ? { includeDocumentByDefault }
        : NO_WORD_PREFERENCES;
    },
  };

function getDeploymentWordIncludeDocumentDefault(): boolean {
  const configured =
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS?.word_include_document;
  return typeof configured === "boolean" ? configured : true;
}

/** The user's choice wins; until they make one, the deployment default applies. */
export function useWordIncludeDocumentByDefault(): [
  boolean,
  (value: boolean) => void,
] {
  const [preferences, setPreferences] = usePersistedState<WordPreferences>(
    WORD_PREFERENCES_KEY,
    NO_WORD_PREFERENCES,
    wordPreferencesPersistedOptions,
  );
  const setIncludeDocumentByDefault = useCallback(
    (value: boolean) =>
      setPreferences((previous) => ({
        ...previous,
        includeDocumentByDefault: value,
      })),
    [setPreferences],
  );
  return [
    preferences.includeDocumentByDefault ??
      getDeploymentWordIncludeDocumentDefault(),
    setIncludeDocumentByDefault,
  ];
}
