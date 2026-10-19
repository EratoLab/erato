import { useEffect, useMemo, useReducer } from "react";

import { getFilePreviewUrl } from "@/components/ui/FileUpload/FilePreviewBase";
import {
  loadStoredTeamsTranscript,
  peekStoredTeamsTranscript,
} from "@/utils/teams/storedTeamsTranscript";
import { isTeamsTranscriptName } from "@/utils/teams/teamsUploadName";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { TeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";

/**
 * The index blocks of the stored Teams transcripts among `files`, keyed by
 * file id. A transcript appears once its download has parsed; until then, and
 * for one that cannot be fetched or carries no block, it is simply absent.
 *
 * Only `teams-*.md` uploads are fetched: both the picker and the desktop
 * export name transcripts that way, and the name keeps every other markdown
 * attachment from being downloaded just to be checked.
 */
export function useStoredTeamsTranscriptIndexes(
  files: readonly FileUploadItem[],
): ReadonlyMap<string, TeamsTranscriptIndex> {
  const [settledLoads, onSettled] = useReducer((count: number) => count + 1, 0);

  const candidates = useMemo(
    () =>
      files.flatMap((file) => {
        const url = getFilePreviewUrl(file);
        return url && isTeamsTranscriptName(file.filename)
          ? [{ id: file.id, url }]
          : [];
      }),
    [files],
  );
  const pendingUrls = candidates
    .map((candidate) => candidate.url)
    .filter((url) => peekStoredTeamsTranscript(url) === undefined);
  const pendingKey = pendingUrls.join("\n");

  useEffect(() => {
    if (pendingKey === "") return;
    let alive = true;
    const settle = () => {
      if (alive) onSettled();
    };
    for (const url of pendingKey.split("\n")) {
      void loadStoredTeamsTranscript(url).then(settle, settle);
    }
    return () => {
      alive = false;
    };
  }, [pendingKey]);

  return useMemo(() => {
    const indexes = new Map<string, TeamsTranscriptIndex>();
    for (const { id, url } of candidates) {
      const stored = peekStoredTeamsTranscript(url);
      if (stored?.kind === "conversation") indexes.set(id, stored.index);
    }
    return indexes;
    // `settledLoads` is the signal that the module cache gained an entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, settledLoads]);
}
