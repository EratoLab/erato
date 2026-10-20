import { describe, expect, it } from "vitest";

import { previewTeamsSend } from "../teamsComposerTranscripts";

import type { TeamsTranscriptRecord } from "../teamsComposerTranscripts";
import type { FileUploadItem } from "@erato/frontend/library";

const upload = (id: string, filename = `${id}.pdf`) =>
  ({ id, filename }) as FileUploadItem;

const record = (
  lineage: string,
  transcriptUploadId: string,
  assetUploadIds: string[] = [],
): TeamsTranscriptRecord => ({
  lineage,
  transcriptUploadId,
  assetUploadIds,
  // Both read `teams-chats-3.md`: the name never tells two apart.
  file: new File(["#"], "teams-chats-3.md"),
  selections: [],
  messageLimit: 200,
});

describe("previewTeamsSend", () => {
  it("finds the staged transcripts in staged order, with their staged assets", () => {
    const first = record("a", "t1", ["a1", "a2"]);
    const second = record("b", "t2", ["b1"]);
    const staged = [
      upload("holiday"),
      upload("t2", "teams-chats-3.md"),
      upload("b1"),
      upload("a2"),
      upload("t1", "teams-chats-3.md"),
    ];

    const preview = previewTeamsSend([first, second], staged);

    expect(
      preview.transcripts.map(({ record: entry, transcript, assets }) => [
        entry.lineage,
        transcript.id,
        assets.map((file) => file.id),
      ]),
    ).toEqual([
      ["b", "t2", ["b1"]],
      ["a", "t1", ["a2"]],
    ]);
    expect(preview.fileIds).toEqual(["holiday", "t2", "b1", "a2", "t1"]);
  });

  it("yields nothing for a record whose transcript is not staged", () => {
    const preview = previewTeamsSend(
      [record("a", "t1", ["a1"])],
      [upload("a1"), upload("holiday")],
    );
    expect(preview.transcripts).toEqual([]);
    expect(preview.fileIds).toEqual(["a1", "holiday"]);
  });

  it("reads records from any iterable, such as the picker's map", () => {
    const records = new Map([["t1", record("a", "t1")]]);
    expect(
      previewTeamsSend(records.values(), [upload("t1")]).transcripts,
    ).toHaveLength(1);
  });
});
