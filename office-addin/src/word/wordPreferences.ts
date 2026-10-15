import {
  usePersistedState,
  type PersistedStateOptions,
} from "@erato/frontend/library";
import { useCallback } from "react";

import {
  isWordCommentAuthorMode,
  WORD_PREFERENCES_KEY,
  wordCommentAuthorOf,
  wordCommentDeploymentSettings,
} from "./utils/wordCommentPolicy";
import { WORD_COMMENT_PRECEDENCES } from "./utils/wordCommentSend";

import type { WordCommentPrecedence } from "./utils/wordCommentSend";
import type { WordCommentAuthorMode } from "@erato/frontend/word-review";

export {
  WORD_PREFERENCES_KEY,
  wordCommentAuthorPreference,
} from "./utils/wordCommentPolicy";

export interface WordPreferences {
  includeDocumentByDefault?: boolean;
  /** What a selection over one comment thread works on (O-19); "selection" until the user chooses. */
  commentPrecedence?: WordCommentPrecedence;
  /** Who Word shows as the author of new comments (O-28); the deployment seeds and may lock it. */
  commentAuthor?: WordCommentAuthorMode;
}

const NO_WORD_PREFERENCES: WordPreferences = {};

const isCommentPrecedence = (value: unknown): value is WordCommentPrecedence =>
  WORD_COMMENT_PRECEDENCES.includes(value as WordCommentPrecedence);

export const wordPreferencesPersistedOptions: PersistedStateOptions<WordPreferences> =
  {
    parse: (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const { includeDocumentByDefault, commentPrecedence, commentAuthor } =
        value as Record<string, unknown>;
      return {
        ...(typeof includeDocumentByDefault === "boolean"
          ? { includeDocumentByDefault }
          : {}),
        ...(isCommentPrecedence(commentPrecedence)
          ? { commentPrecedence }
          : {}),
        ...(isWordCommentAuthorMode(commentAuthor) ? { commentAuthor } : {}),
      };
    },
  };

function getDeploymentWordIncludeDocumentDefault(): boolean {
  const configured =
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS?.word_include_document;
  return typeof configured === "boolean" ? configured : true;
}

function useWordPreferences() {
  return usePersistedState<WordPreferences>(
    WORD_PREFERENCES_KEY,
    NO_WORD_PREFERENCES,
    wordPreferencesPersistedOptions,
  );
}

/** The user's choice wins; until they make one, the deployment default applies. */
export function useWordIncludeDocumentByDefault(): [
  boolean,
  (value: boolean) => void,
] {
  const [preferences, setPreferences] = useWordPreferences();
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

/** Per device, with no deployment seed (O-20): "selection" until the user chooses. */
export function useWordCommentPrecedence(): [
  WordCommentPrecedence,
  (value: WordCommentPrecedence) => void,
] {
  const [preferences, setPreferences] = useWordPreferences();
  const setCommentPrecedence = useCallback(
    (value: WordCommentPrecedence) =>
      setPreferences((previous) => ({ ...previous, commentPrecedence: value })),
    [setPreferences],
  );
  return [preferences.commentPrecedence ?? "selection", setCommentPrecedence];
}

/** Per device, seeded by the deployment; a locked deployment value cannot be changed. */
export function useWordCommentAuthor(): [
  WordCommentAuthorMode,
  (value: WordCommentAuthorMode) => void,
  boolean,
] {
  const [preferences, setPreferences] = useWordPreferences();
  const setCommentAuthor = useCallback(
    (value: WordCommentAuthorMode) =>
      setPreferences((previous) => ({ ...previous, commentAuthor: value })),
    [setPreferences],
  );
  return [
    wordCommentAuthorOf(preferences.commentAuthor),
    setCommentAuthor,
    wordCommentDeploymentSettings().authorEnforced,
  ];
}
