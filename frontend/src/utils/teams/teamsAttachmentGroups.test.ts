import { describe, expect, it } from "vitest";

import {
  teamsIndex,
  teamsMessage,
  teamsSection,
} from "@/test/teamsTranscriptFixtures";

import { buildTeamsMessageAttachmentGroups } from "./teamsAttachmentGroups";

import type { TeamsAttachmentPreviewGroups } from "./teamsAttachmentGroups";
import type {
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
} from "./teamsTranscriptIndex";
import type { FileAttachmentGroup } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const TRANSCRIPT = upload("teams-Product_sync.md", "upload-transcript");

function itemKinds(group: FileAttachmentGroup): string[] {
  return group.items.map((item) => item.kind);
}

function transcriptRow(group: FileAttachmentGroup) {
  const [first] = group.items;
  if (first.kind !== "attachment") {
    throw new Error(`expected a transcript row, got ${first.kind}`);
  }
  return first;
}

function groupsOf(
  preview: TeamsAttachmentPreviewGroups | null,
): FileAttachmentGroup[] {
  if (!preview) throw new Error("expected a grouping");
  return preview.groups;
}

describe("buildTeamsMessageAttachmentGroups", () => {
  const index = (
    section: Partial<TeamsTranscriptIndexSection> = {},
    messages: TeamsTranscriptIndexMessage[] = [
      teamsMessage("m1"),
      teamsMessage("m2"),
    ],
  ) => teamsIndex([teamsSection(section)], messages);

  it("leaves a message whose transcripts are not read yet to the caller", () => {
    expect(
      buildTeamsMessageAttachmentGroups([TRANSCRIPT], new Map()),
    ).toBeNull();
    expect(
      buildTeamsMessageAttachmentGroups(
        [TRANSCRIPT],
        new Map([[TRANSCRIPT.id, teamsIndex([], [])]]),
      ),
    ).toBeNull();
  });

  it("renders a stored transcript as its conversation, expanded", () => {
    const preview = buildTeamsMessageAttachmentGroups(
      [TRANSCRIPT, upload("holiday.pdf")],
      new Map([[TRANSCRIPT.id, index({ truncated: true })]]),
    );

    const [group] = groupsOf(preview);
    expect(group.label).toBe("Product sync");
    expect(group.metaLabel).toContain("2 messages");
    expect(group.defaultCollapsed).toBe(false);
    // The whole upload, so opening the row previews the transcript itself.
    expect(transcriptRow(group).file).toEqual({
      ...TRANSCRIPT,
      displayName: "Part of the conversation",
    });
    expect(transcriptRow(group).onOpen).toBeUndefined();
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("keeps hand-picked messages to the summary row once sent", () => {
    const preview = buildTeamsMessageAttachmentGroups(
      [TRANSCRIPT],
      new Map([[TRANSCRIPT.id, index({ selection: "messages" })]]),
    );

    const [group] = groupsOf(preview);
    expect(itemKinds(group)).toEqual(["attachment"]);
    expect(transcriptRow(group).file).toMatchObject({
      displayName: "Selected messages",
    });
  });

  it("claims the shared files under the names Teams gave them", () => {
    const image = upload("teams-img-0123456789abcdef.png", "upload-image");
    const shared = upload("teams-file-abcd1234-Q3_report.pdf", "upload-file");
    const preview = buildTeamsMessageAttachmentGroups(
      [TRANSCRIPT, image, shared],
      new Map([
        [
          TRANSCRIPT.id,
          index({}, [
            teamsMessage("m1", {
              assets: [
                { name: image.filename, displayName: null, kind: "image" },
                {
                  name: "teams-img-never-uploaded.png",
                  displayName: null,
                  kind: "image",
                },
              ],
            }),
            teamsMessage("m2", {
              assets: [
                {
                  name: shared.filename,
                  displayName: "Q3 report.pdf",
                  kind: "file",
                },
              ],
            }),
          ]),
        ],
      ]),
    );

    const [group] = groupsOf(preview);
    expect(
      group.items
        .slice(1)
        .map((item) => (item.kind === "attachment" ? item.file : null)),
    ).toEqual([
      { ...image, displayName: "Image" },
      { ...shared, displayName: "Q3 report.pdf" },
    ]);
  });

  it("keeps two transcripts of one message apart", () => {
    const second = upload("teams-chat.md", "upload-second");
    const preview = buildTeamsMessageAttachmentGroups(
      [TRANSCRIPT, second],
      new Map([
        [TRANSCRIPT.id, index()],
        [
          second.id,
          index({ title: "Releases", teamName: "Contoso" }, [
            teamsMessage("c1"),
          ]),
        ],
      ]),
    );

    const groups = groupsOf(preview);
    expect(groups.map((group) => group.label)).toEqual([
      "Product sync",
      "Releases · Contoso",
    ]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    expect(transcriptRow(groups[1]).file).toMatchObject({ id: second.id });
  });
});
