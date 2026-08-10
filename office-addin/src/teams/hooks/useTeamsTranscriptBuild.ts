import { useCallback, useEffect, useRef, useState } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { buildTeamsTranscriptFile } from "../utils/buildTeamsTranscriptFile";
import { collectTeamsTranscript } from "../utils/collectTeamsTranscript";
import { TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type { TeamsTranscriptProgress } from "../utils/collectTeamsTranscript";
import type {
  ParsedTeamsChat,
  TeamsSelfIdentity,
} from "../utils/parsedTeamsChat";
import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";
import type { TeamsFetchState } from "../utils/teamsChatGraph";
import type { TeamsChatSelection } from "../utils/teamsChatSelection";

export interface TeamsTranscriptBuildOutcome {
  /** Null when nothing renderable was fetched — never upload an empty file. */
  file: File | null;
  state: TeamsFetchState;
  messageCount: number;
  skippedCount: number;
  chatsTotal: number;
  chatsCompleted: number;
}

export interface UseTeamsTranscriptBuildResult {
  build: (args: {
    selections: readonly TeamsChatSelection[];
    knownChats?: ReadonlyMap<string, ParsedTeamsChat>;
    self?: TeamsSelfIdentity;
    limit?: number;
  }) => Promise<TeamsTranscriptBuildOutcome>;
  progress: TeamsTranscriptProgress | null;
  isBuilding: boolean;
  cancel: () => void;
  reset: () => void;
}

const ABORTED_OUTCOME: TeamsTranscriptBuildOutcome = {
  file: null,
  state: "error",
  messageCount: 0,
  skippedCount: 0,
  chatsTotal: 0,
  chatsCompleted: 0,
};

/**
 * The imperative half of the picker: hydrate the selection and serialize it.
 * Not a query — it is a user action with progress and a cancel.
 *
 * Mount this ABOVE the dialog. The controller lives here, so a dialog that
 * unmounts mid-build (Escape, overlay click) still aborts the in-flight fetch
 * and still resolves, rather than orphaning it.
 *
 * Never throws and always clears `isBuilding`: a timeout or an abort resolves
 * with whatever landed so the caller can offer it or roll back its dedupe claim.
 */
export function useTeamsTranscriptBuild(
  fetcher: TeamsChatFetcher | null,
): UseTeamsTranscriptBuildResult {
  const [progress, setProgress] = useState<TeamsTranscriptProgress | null>(
    null,
  );
  const [isBuilding, setIsBuilding] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    setProgress(null);
  }, []);

  const build = useCallback(
    async (args: {
      selections: readonly TeamsChatSelection[];
      knownChats?: ReadonlyMap<string, ParsedTeamsChat>;
      self?: TeamsSelfIdentity;
      limit?: number;
    }): Promise<TeamsTranscriptBuildOutcome> => {
      if (!fetcher || args.selections.length === 0) {
        return ABORTED_OUTCOME;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setProgress(null);
      setIsBuilding(true);
      try {
        const collected = await runWithGraphTimeout(
          TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS,
          `Teams transcript build timed out after ${TEAMS_GRAPH_TRANSCRIPT_TIMEOUT_MS}ms`,
          controller.signal,
          (signal) =>
            collectTeamsTranscript({
              fetcher,
              selections: args.selections,
              knownChats: args.knownChats,
              self: args.self,
              limit: args.limit,
              signal,
              onProgress: setProgress,
            }),
        );
        return {
          file: buildTeamsTranscriptFile({
            sections: collected.sections,
            // The picker renders every row in the viewer's zone; a transcript
            // in UTC would file those same messages under a different day.
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          state: collected.state,
          messageCount: collected.messageCount,
          skippedCount: collected.skippedCount,
          chatsTotal: collected.chatsTotal,
          chatsCompleted: collected.chatsCompleted,
        };
      } catch (error) {
        console.warn("[useTeamsTranscriptBuild] build failed:", error);
        return ABORTED_OUTCOME;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsBuilding(false);
      }
    },
    [fetcher],
  );

  return { build, progress, isBuilding, cancel, reset };
}
