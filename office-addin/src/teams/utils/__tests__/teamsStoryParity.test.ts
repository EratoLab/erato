import {
  readTeamsTranscriptIndex,
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
  useTeamsTranscriptContextItems,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, renderHook } from "@testing-library/react";
import { format } from "prettier";
import { afterEach, beforeAll, expect, it } from "vitest";

import { messages as frontendMessages } from "../../../../../frontend/src/locales/en/messages.po";
import {
  TEAMS_STORIES,
  TEAMS_STORY_FLOWS,
  teamsStoryFileName,
  teamsStoryId,
  teamsStoryStaged,
  teamsStoryTranscriptText,
  teamsStoryTranscriptUploads,
} from "../../../../../frontend/src/stories/chat/composerContextTeamsScenarios";
import { previewTeamsSend } from "../teamsComposerTranscripts";

import type {
  TeamsStorySeed,
  TeamsStoryTranscript,
} from "../../../../../frontend/src/stories/chat/composerContextTeamsScenarios";
import type { TeamsTranscriptRecord } from "../teamsComposerTranscripts";
import type {
  ComposerContextItem,
  FileUploadItem,
  TeamsTranscriptContextEntry,
} from "@erato/frontend/library";

// The Storybook stories play the Teams composer from data. This runs the
// add-in's send preview and the library's chip hook on every story and flow
// and writes what each draws; the Storybook spec holds the stories to that
// file, so the copy cannot drift from the add-in unnoticed. After a
// deliberate change, update the file with
// `pnpm exec vitest run src/teams/utils/__tests__/teamsStoryParity.test.ts -u`
// and then the stories until the spec agrees.
const EXPECTED =
  "../../../../../e2e-tests/storybook-teams-context-chips/teams-chips.expected.json";

const noop = () => {};

/** jsdom's `File` has no `text()`; a slow read never finishes here. */
function transcriptFile(transcript: TeamsStoryTranscript): File {
  const text = teamsStoryTranscriptText(transcript, {
    marker: TEAMS_TRANSCRIPT_INDEX_MARKER,
    version: TEAMS_TRANSCRIPT_INDEX_VERSION,
  });
  const file = new File([text], teamsStoryFileName(transcript.conversations));
  Object.defineProperty(file, "text", {
    value: () =>
      transcript.slowRead ? new Promise<string>(noop) : Promise.resolve(text),
  });
  return file;
}

const upload = (id: string, filename: string): FileUploadItem => ({
  id,
  filename,
  download_url: `https://example.com/${id}`,
  file_contents_unavailable_missing_permissions: false,
  is_sharepoint_file: false,
  file_capability: {
    id: "other",
    extensions: [],
    mime_types: [],
    operations: ["extract_text"],
  },
});

/** What TeamsChatInput hands the lane for a story's records and staged files. */
async function addinItems(seed: TeamsStorySeed) {
  const records: TeamsTranscriptRecord[] = await Promise.all(
    seed.transcripts.map(async (transcript) => {
      const file = transcriptFile(transcript);
      // The picker reads the index before it hands a transcript over.
      if (!transcript.slowRead) await readTeamsTranscriptIndex(file);
      return {
        lineage: transcript.lineage,
        transcriptUploadId: transcript.uploadId,
        assetUploadIds: teamsStoryTranscriptUploads(transcript).assets.map(
          (asset) => asset.id,
        ),
        file,
        selections: [],
        messageLimit: 200,
      };
    }),
  );
  const staged = teamsStoryStaged(seed).map((file) =>
    upload(file.id, file.filename),
  );
  const preview = previewTeamsSend(records, staged);
  const canPick = seed.picker !== false;
  const entries = preview.transcripts.map(
    ({ record, transcript, assets }): TeamsTranscriptContextEntry => ({
      id: record.lineage,
      transcript: record.file,
      uploads: { transcript, assets },
      onRemove: noop,
      onEditSelection: canPick ? noop : undefined,
    }),
  );
  const { result } = renderHook(() =>
    useTeamsTranscriptContextItems(entries, { onRemoveFile: noop }),
  );
  return { items: result.current, sendFileIds: preview.fileIds };
}

/** What a chip shows and claims: the fields the Storybook spec reads. */
function summary(
  seed: TeamsStorySeed,
  {
    items,
    sendFileIds,
  }: { items: ComposerContextItem[]; sendFileIds: string[] },
) {
  return {
    composerLocked: seed.locked === true,
    chips: items.map((item) => ({
      kind: item.kind,
      origin: item.origin,
      state: item.state,
      label: item.label,
      meta: item.meta ?? null,
      spokenLabel: item.spokenLabel ?? null,
      control: item.removeLabel ?? null,
      removeAction: item.removeActionLabel ?? null,
      removed: item.announcements?.removed ?? null,
      detailTitle: item.detail?.title ?? null,
      actions: (item.detail?.actions ?? []).map((action) => action.label),
      claims: item.claimsFileIds ?? [],
    })),
    sendFileIds,
  };
}

// The library is built without its default messages; the chips read the
// frontend's English catalog, as the add-in loads it.
beforeAll(() => {
  i18n.loadAndActivate({ locale: "en", messages: frontendMessages });
});

afterEach(() => {
  cleanup();
});

it("writes the chips the add-in draws for every Teams story and flow", async () => {
  const stories: Record<string, ReturnType<typeof summary>> = {};
  for (const [name, seed] of Object.entries(TEAMS_STORIES)) {
    stories[teamsStoryId(name)] = summary(seed, await addinItems(seed));
  }
  const flows: Record<string, ReturnType<typeof summary> & { story: string }> =
    {};
  for (const [name, flow] of Object.entries(TEAMS_STORY_FLOWS)) {
    flows[name] = {
      story: teamsStoryId(flow.story),
      ...summary(flow.then, await addinItems(flow.then)),
    };
  }
  const json = await format(JSON.stringify({ stories, flows }), {
    parser: "json",
  });
  await expect(json).toMatchFileSnapshot(EXPECTED);
});
