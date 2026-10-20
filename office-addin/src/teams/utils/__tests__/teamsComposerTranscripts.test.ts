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
  names: Partial<
    Pick<TeamsTranscriptRecord, "assetNames" | "excludedAssetNames">
  > = {},
): TeamsTranscriptRecord => ({
  lineage,
  transcriptUploadId,
  assetUploadIds,
  assetNames: assetUploadIds.map((id) => `${id}.pdf`),
  excludedAssetNames: [],
  ...names,
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

  it("names the assets handed over that the composer did not take", () => {
    const attached = record("a", "t1", ["a1", "a2"], {
      assetNames: ["a1.pdf", "a2.pdf", "a3.pdf", "a4.pdf"],
      excludedAssetNames: ["a2.pdf"],
    });
    const [entry] = previewTeamsSend(
      [attached],
      [upload("t1", "teams-chats-3.md"), upload("a1")],
    ).transcripts;
    // a2 the user removed; a3 and a4 never came back from the upload.
    expect(entry.notAttachedAssetNames).toEqual(["a3.pdf", "a4.pdf"]);
  });

  it("reads records from any iterable, such as the picker's map", () => {
    const records = new Map([["t1", record("a", "t1")]]);
    expect(
      previewTeamsSend(records.values(), [upload("t1")]).transcripts,
    ).toHaveLength(1);
  });
});
