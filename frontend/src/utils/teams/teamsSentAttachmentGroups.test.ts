import { describe, expect, it } from "vitest";

import { groupTeamsSentAttachments } from "./teamsSentAttachmentGroups";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const file = (id: string, filename: string): FileUploadItem =>
  ({
    id,
    filename,
    download_url: `https://example.invalid/${id}`,
  }) as FileUploadItem;

const transcript = file("t1", "teams-Product_sync.md");
const sharedImage = file("i1", "teams-img-0123456789abcdef.png");
const sharedFile = file("f1", "teams-file-abcd1234-Q3_report.pdf");
const ordinary = file("o1", "holiday.pdf");

describe("groupTeamsSentAttachments", () => {
  it("gathers a transcript and the files shared inside it into one group", () => {
    const grouping = groupTeamsSentAttachments([
      transcript,
      sharedImage,
      sharedFile,
    ]);

    expect(grouping?.groups).toHaveLength(1);
    expect(grouping?.groups[0].items.map((item) => item.id)).toEqual([
      "t1",
      "i1",
      "f1",
    ]);
    expect(grouping?.claimedFileIds).toEqual(new Set(["t1", "i1", "f1"]));
  });

  it("leaves anything it does not claim for the caller to render", () => {
    const grouping = groupTeamsSentAttachments([
      transcript,
      sharedFile,
      ordinary,
    ]);

    expect(grouping?.claimedFileIds.has("o1")).toBe(false);
  });

  it("names the shared files it gathered", () => {
    expect(
      groupTeamsSentAttachments([transcript, sharedFile])?.groups[0].metaLabel,
    ).toBe("1 shared file");
    expect(
      groupTeamsSentAttachments([transcript, sharedFile, sharedImage])
        ?.groups[0].metaLabel,
    ).toBe("2 shared files");
  });

  it("groups nothing without a transcript, however minted the uploads look", () => {
    expect(groupTeamsSentAttachments([sharedImage, sharedFile])).toBeNull();
  });

  it("groups nothing for a transcript that shared no files", () => {
    // A bare transcript is already one thing; there are no siblings to gather.
    expect(groupTeamsSentAttachments([transcript, ordinary])).toBeNull();
  });

  it("does not mistake a hand-uploaded teams-ish markdown file for a transcript", () => {
    // The transcript name is derived from the conversation title, so it is a
    // weak signal on its own — a minted upload alongside it is what confirms it.
    expect(
      groupTeamsSentAttachments([file("n1", "teams-notes.md"), ordinary]),
    ).toBeNull();
  });

  it("recovers readable names for the files it gathers", () => {
    const items = groupTeamsSentAttachments([
      transcript,
      sharedFile,
      sharedImage,
    ])?.groups[0].items;

    expect(items?.[1]).toMatchObject({
      file: { displayName: "Q3_report.pdf" },
    });
    expect(items?.[2]).toMatchObject({ file: { displayName: "Image.png" } });
  });
});
