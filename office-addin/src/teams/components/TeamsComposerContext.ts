import { createContext, useContext } from "react";

import type { TeamsComposerBridge } from "../hooks/useTeamsComposerBridge";
import type { TeamsTranscriptRecord } from "../utils/teamsComposerTranscripts";

export interface TeamsComposerContextValue {
  bridge: TeamsComposerBridge;
  /** The staged transcript nearest the textarea; "+" edits it. */
  stagedTranscript: TeamsTranscriptRecord | null;
}

export const TeamsComposerContext =
  createContext<TeamsComposerContextValue | null>(null);

/** Null outside the Teams composer. */
export const useTeamsComposer = (): TeamsComposerContextValue | null =>
  useContext(TeamsComposerContext);
