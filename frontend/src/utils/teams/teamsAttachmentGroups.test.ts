import { describe, expect, it } from "vitest";

import {
  teamsIndex,
  teamsMessage,
  teamsSection,
} from "@/test/teamsTranscriptFixtures";

import {
  buildTeamsAttachmentGroups,
  buildTeamsSummaryAttachmentGroups,
} from "./teamsAttachmentGroups";

import type {
  TeamsAttachedTranscript,
  TeamsAttachmentPreviewGroups,
} from "./teamsAttachmentGroups";
import type {
  TeamsTranscriptIndexMessage,
  TeamsTranscriptIndexSection,
} from "./teamsTranscriptIndex";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";
import type {
  FileUploadItem,
  TeamsTranscriptSummary,
  TeamsTranscriptSummarySection,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const TRANSCRIPT = upload("teams-Product_sync.md", "upload-transcript");

function attach(
  sections: TeamsTranscriptIndexSection[],
  messages: TeamsTranscriptIndexMessage[],
): TeamsAttachedTranscript {
  return {
    fileName: TRANSCRIPT.filename,
    index: teamsIndex(sections, messages),
  };
}

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

type ThreadRow = Extract<
  FileAttachmentGroupItem,
  { kind: "threadMessageGroup" }
>;

function threadRows(group: FileAttachmentGroup): ThreadRow[] {
  return group.items.filter(
    (item): item is ThreadRow => item.kind === "threadMessageGroup",
  );
}

function groupsOf(
  preview: TeamsAttachmentPreviewGroups | null,
): FileAttachmentGroup[] {
  if (!preview) throw new Error("expected a grouping");
  return preview.groups;
}

describe("buildTeamsAttachmentGroups", () => {
  it("falls back to flat chips when the index is unavailable", () => {
    expect(buildTeamsAttachmentGroups(null, [TRANSCRIPT])).toBeNull();
    expect(buildTeamsAttachmentGroups(attach([], []), [TRANSCRIPT])).toBeNull();
  });

  it("falls back to flat chips when the transcript is no longer attached", () => {
    expect(
      buildTeamsAttachmentGroups(
        attach([teamsSection()], [teamsMessage("m1")]),
        [upload("holiday.pdf")],
      ),
    ).toBeNull();
  });

  it("summarises a whole conversation instead of listing its messages", () => {
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ truncated: true })],
        [teamsMessage("m1"), teamsMessage("m2")],
      ),
      [TRANSCRIPT],
    );

    const [group] = groupsOf(preview);
    expect(group.label).toBe("Product sync");
    expect(group.metaLabel).toContain("2 messages");
    expect(group.collapsible).toBe(true);
    expect(group.defaultCollapsed).toBe(true);
    expect(itemKinds(group)).toEqual(["attachment"]);
    expect(transcriptRow(group).file).toEqual({
      id: TRANSCRIPT.id,
      filename: TRANSCRIPT.filename,
      displayName: "Part of the conversation",
    });
  });

  it("renders one card per hand-picked message, in index order", () => {
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ selection: "messages", limit: null })],
        [
          teamsMessage("m1", { sender: "Ada Lovelace" }),
          teamsMessage("m2", { sender: "Grace Hopper" }),
        ],
      ),
      [TRANSCRIPT],
    );

    const [group] = groupsOf(preview);
    expect(group.defaultCollapsed).toBe(false);
    expect(transcriptRow(group).file).toMatchObject({
      displayName: "Selected messages",
    });
    expect(threadRows(group).map((row) => row.label)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    // Nothing can be taken back out of an uploaded transcript.
    expect(threadRows(group).every((row) => row.onToggle === undefined)).toBe(
      true,
    );
  });

  it("shows an excerpt so two messages from one sender are distinguishable", () => {
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ selection: "messages" })],
        [
          teamsMessage("m1", { text: "Can we move the sync to Thursday?" }),
          teamsMessage("m2", { text: "Actually Friday works better." }),
        ],
      ),
      [TRANSCRIPT],
    );

    const rows = threadRows(groupsOf(preview)[0]);
    expect(rows[0].sublabel).toContain("Can we move the sync to Thursday?");
    expect(rows[1].sublabel).toContain("Actually Friday works better.");
  });

  it("truncates a long excerpt and flattens its whitespace", () => {
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ selection: "messages" })],
        [
          teamsMessage("m1", { text: `A${"b".repeat(200)}` }),
          teamsMessage("m2", { text: "line one\n\n  line two" }),
        ],
      ),
      [TRANSCRIPT],
    );

    const rows = threadRows(groupsOf(preview)[0]);
    expect(rows[0].sublabel).toContain(`A${"b".repeat(99)}…`);
    expect(rows[0].sublabel).not.toContain("b".repeat(101));
    expect(rows[1].sublabel).toContain("line one line two");
  });

  it("keeps one group per conversation across chats and channels", () => {
    const channelRef = {
      kind: "channel",
      teamId: "team-1",
      channelId: "chan-1",
    } as const;
    const preview = buildTeamsAttachmentGroups(
      attach(
        [
          teamsSection({ selection: "messages" }),
          teamsSection({
            kind: "channel",
            ref: channelRef,
            title: "Releases",
            teamName: "Contoso",
            selection: "messages",
          }),
        ],
        [
          teamsMessage("k1", { sender: "Ada Lovelace" }),
          teamsMessage("k2", { sender: "Grace Hopper" }),
          teamsMessage("c1", { section: 1, sender: "Tom Weber" }),
          teamsMessage("c2", { section: 1, sender: "Anna Roth" }),
        ],
      ),
      [TRANSCRIPT],
    );

    const groups = groupsOf(preview);
    expect(groups.map((group) => group.label)).toEqual([
      "Product sync",
      "Releases · Contoso",
    ]);
    // The index is one flat array tagged by section, so a wrong partition
    // silently merges every conversation into every card.
    expect(threadRows(groups[0]).map((row) => row.label)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    expect(threadRows(groups[1]).map((row) => row.label)).toEqual([
      "Tom Weber",
      "Anna Roth",
    ]);
    expect(groups[0].metaLabel).toContain("2 messages");
    expect(groups[1].metaLabel).toContain("2 messages");
    for (const group of groups) {
      expect(transcriptRow(group).file).toMatchObject({ id: TRANSCRIPT.id });
    }
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("nests a message's uploads under it, joined by the stamped filename", () => {
    const image = upload("teams-img-abc.png", "upload-image");
    const shared = upload("teams-file-abc-report.pdf", "upload-report");
    const unrelated = upload("holiday.pdf", "upload-holiday");
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ selection: "messages" })],
        [
          teamsMessage("m1", {
            assets: [
              { name: image.filename, displayName: null, kind: "image" },
              { name: shared.filename, displayName: null, kind: "file" },
            ],
          }),
          teamsMessage("m2"),
        ],
      ),
      [TRANSCRIPT, image, shared, unrelated],
    );

    const rows = threadRows(groupsOf(preview)[0]);
    expect(rows[0].attachments.map((item) => item.file)).toEqual([
      { id: image.id, filename: image.filename, displayName: "Image" },
      { id: shared.id, filename: shared.filename, displayName: "Attachment" },
    ]);
    expect(rows[1].attachments).toEqual([]);
    expect([...preview!.claimedFileIds].sort()).toEqual([
      image.id,
      shared.id,
      TRANSCRIPT.id,
    ]);
  });

  it("never claims an upload the index does not name", () => {
    const own = upload("report.pdf", "upload-own");
    const preview = buildTeamsAttachmentGroups(
      attach([teamsSection({ selection: "messages" })], [teamsMessage("m1")]),
      [TRANSCRIPT, own],
    );

    expect(threadRows(groupsOf(preview)[0])[0].attachments).toEqual([]);
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("lists a whole conversation's uploads beside its summary row, once each", () => {
    const image = upload("teams-img-abc.png", "upload-image");
    const asset = {
      name: image.filename,
      displayName: null,
      kind: "image" as const,
    };
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection()],
        [
          teamsMessage("m1", { assets: [asset] }),
          teamsMessage("m2", { assets: [asset] }),
        ],
      ),
      [TRANSCRIPT, image],
    );

    const [group] = groupsOf(preview);
    expect(itemKinds(group)).toEqual(["attachment", "attachment"]);
    expect(group.items[1]).toEqual({
      kind: "attachment",
      id: image.id,
      file: { id: image.id, filename: image.filename, displayName: "Image" },
    });
  });

  it("reports how many messages could not be loaded", () => {
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection({ selection: "messages", skippedCount: 2 })],
        [teamsMessage("m1")],
      ),
      [TRANSCRIPT],
    );

    expect(transcriptRow(groupsOf(preview)[0]).file).toMatchObject({
      displayName: "Selected messages · 2 could not be loaded",
    });
  });

  it("opens the section its summary row stands for", () => {
    const opened: number[] = [];
    const preview = buildTeamsAttachmentGroups(
      attach(
        [teamsSection(), teamsSection({ title: "Design review" })],
        [teamsMessage("m1"), teamsMessage("m2", { section: 1 })],
      ),
      [TRANSCRIPT],
      (section) => opened.push(section),
    );

    transcriptRow(groupsOf(preview)[1]).onOpen?.();
    expect(opened).toEqual([1]);
  });
});

function summarySection(
  overrides: Partial<TeamsTranscriptSummarySection> = {},
): TeamsTranscriptSummarySection {
  return {
    kind: "chat",
    title: "Product sync",
    team_name: null,
    selection: "whole-chat",
    truncated: false,
    skipped_count: 0,
    message_count: 12,
    window: { from: "2026-03-01T08:00:00Z", to: "2026-03-03T09:14:00Z" },
    participants: ["Ada Lovelace"],
    assets: [],
    ...overrides,
  };
}

function summarised(
  file: FileUploadItem,
  sections: TeamsTranscriptSummarySection[],
): FileUploadItem {
  const summary: TeamsTranscriptSummary = { sections };
  return { ...file, teams_transcript: summary };
}

describe("buildTeamsSummaryAttachmentGroups", () => {
  it("leaves files without a summary to the caller", () => {
    expect(
      buildTeamsSummaryAttachmentGroups([TRANSCRIPT, upload("holiday.pdf")]),
    ).toBeNull();
    expect(
      buildTeamsSummaryAttachmentGroups([summarised(TRANSCRIPT, [])]),
    ).toBeNull();
  });

  it("renders a stored transcript as its conversation, open and expanded", () => {
    const transcript = summarised(TRANSCRIPT, [
      summarySection({ truncated: true }),
    ]);
    const preview = buildTeamsSummaryAttachmentGroups([
      transcript,
      upload("holiday.pdf"),
    ]);

    const [group] = groupsOf(preview);
    expect(group.label).toBe("Product sync");
    expect(group.metaLabel).toContain("12 messages");
    expect(group.defaultCollapsed).toBe(false);
    // The whole upload, so opening the row previews the transcript itself.
    expect(transcriptRow(group).file).toEqual({
      ...transcript,
      displayName: "Part of the conversation",
    });
    expect(transcriptRow(group).onOpen).toBeUndefined();
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("claims the shared files under the names Teams gave them", () => {
    const image = upload("teams-img-0123456789abcdef.png", "upload-image");
    const shared = upload("teams-file-abcd1234-Q3_report.pdf", "upload-file");
    const preview = buildTeamsSummaryAttachmentGroups([
      summarised(TRANSCRIPT, [
        summarySection({
          assets: [
            { name: image.filename, display_name: null, kind: "image" },
            {
              name: shared.filename,
              display_name: "Q3 report.pdf",
              kind: "file",
            },
            {
              name: "teams-img-never-uploaded.png",
              display_name: null,
              kind: "image",
            },
          ],
        }),
      ]),
      image,
      shared,
    ]);

    const [group] = groupsOf(preview);
    expect(group.items.slice(1).map((item) => item.kind)).toEqual([
      "attachment",
      "attachment",
    ]);
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
    const preview = buildTeamsSummaryAttachmentGroups([
      summarised(TRANSCRIPT, [summarySection()]),
      summarised(second, [
        summarySection({
          kind: "channel",
          title: "Releases",
          team_name: "Contoso",
          selection: "messages",
        }),
      ]),
    ]);

    const groups = groupsOf(preview);
    expect(groups.map((group) => group.label)).toEqual([
      "Product sync",
      "Releases · Contoso",
    ]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    expect(transcriptRow(groups[1]).file).toMatchObject({
      id: second.id,
      displayName: "Selected messages",
    });
  });
});
