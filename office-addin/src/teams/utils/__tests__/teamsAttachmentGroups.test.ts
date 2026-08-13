import {
  TEAMS_TRANSCRIPT_INDEX_VERSION,
  parseTeamsTranscriptIndex,
} from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { beforeEach, describe, expect, it } from "vitest";

import { MOCK_CHAT_ID } from "../../../test/mocks/teams/graph";
import { buildTeamsTranscriptDocument } from "../buildTeamsTranscriptFile";
import { buildTeamsAttachmentGroups } from "../teamsAttachmentGroups";
import { buildTeamsMessageDeepLink } from "../teamsDeepLink";

import type { TeamsTranscriptSection } from "../buildTeamsTranscriptFile";
import type { ParsedTeamsChannel } from "../parsedTeamsChannel";
import type { ParsedTeamsChat, ParsedTeamsMessage } from "../parsedTeamsChat";
import type { TeamsAttachedTranscript } from "../teamsAttachmentGroups";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  FileUploadItem,
} from "@erato/frontend/library";

const chat: ParsedTeamsChat = {
  chatId: MOCK_CHAT_ID,
  title: "Product sync",
  participants: ["Ada Lovelace"],
  selfDisplayName: null,
  participantsTruncated: false,
  chatType: "group",
  lastActivityAt: "2026-08-10T09:15:00Z",
  previewText: "",
};

const channel: ParsedTeamsChannel = {
  ref: { kind: "channel", teamId: "team-1", channelId: "chan-1" },
  teamId: "team-1",
  channelId: "chan-1",
  name: "Releases",
  teamName: "Contoso",
  membershipType: "standard",
  isThreaded: true,
};

function message(
  overrides: Partial<ParsedTeamsMessage> = {},
): ParsedTeamsMessage {
  const messageId = overrides.messageId ?? "1741000000000";
  return {
    chatId: MOCK_CHAT_ID,
    messageId,
    senderName: "Ada Lovelace",
    createdAt: "2026-03-03T09:14:00Z",
    editedAt: null,
    subject: null,
    text: "Can we move the sync to Thursday?",
    markers: [],
    sharedFiles: [],
    imageUrls: [],
    replyToId: null,
    deepLink: buildTeamsMessageDeepLink(MOCK_CHAT_ID, messageId),
    ...overrides,
  };
}

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const TRANSCRIPT = upload("teams-Product_sync.md", "upload-transcript");

function chatSection(
  overrides: Partial<Extract<TeamsTranscriptSection, { kind: "chat" }>> = {},
): TeamsTranscriptSection {
  return {
    kind: "chat",
    chat,
    messages: [message()],
    selection: "whole-chat",
    limit: 200,
    ...overrides,
  };
}

/**
 * The preview's real input: the index block as it survives a round trip
 * through the transcript the composer holds.
 */
function attach(sections: TeamsTranscriptSection[]): TeamsAttachedTranscript {
  const document = buildTeamsTranscriptDocument({ sections, timeZone: "UTC" });
  if (!document) throw new Error("expected a transcript");
  const index = parseTeamsTranscriptIndex(document.markdown);
  if (!index) throw new Error("expected an index block");
  return { fileName: TRANSCRIPT.filename, index };
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

describe("buildTeamsAttachmentGroups", () => {
  beforeEach(() => {
    i18n.activate("en");
  });

  it("falls back to flat chips when the index is unavailable", () => {
    expect(buildTeamsAttachmentGroups(null, [TRANSCRIPT])).toBeNull();
    expect(
      buildTeamsAttachmentGroups(
        {
          fileName: TRANSCRIPT.filename,
          index: {
            version: TEAMS_TRANSCRIPT_INDEX_VERSION,
            exportedAt: "2026-03-03T10:00:00Z",
            timeZone: "UTC",
            sections: [],
            messages: [],
          },
        },
        [TRANSCRIPT],
      ),
    ).toBeNull();
  });

  it("falls back to flat chips when the transcript is no longer attached", () => {
    expect(
      buildTeamsAttachmentGroups(attach([chatSection()]), [
        upload("holiday.pdf"),
      ]),
    ).toBeNull();
  });

  it("summarises a whole conversation instead of listing its messages", () => {
    const messages = [
      message({ messageId: "m2", createdAt: "2026-03-03T09:14:00Z" }),
      message({ messageId: "m1", createdAt: "2026-03-01T08:00:00Z" }),
    ];
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({ messages, selection: "whole-chat", truncated: true }),
      ]),
      [TRANSCRIPT],
    );

    expect(preview).not.toBeNull();
    const [group] = preview!.groups;
    expect(group.label).toBe("Product sync");
    expect(group.metaLabel).toContain("2 messages");
    expect(group.collapsible).toBe(true);
    expect(group.defaultCollapsed).toBe(true);
    expect(itemKinds(group)).toEqual(["attachment"]);
    const row = transcriptRow(group);
    expect(row.file).toMatchObject({
      id: TRANSCRIPT.id,
      displayName: "Recent messages — older ones not included",
    });
  });

  it("renders one card per hand-picked message, in transcript order", () => {
    // Newest first, as Graph hands chat messages back.
    const messages = [
      message({
        messageId: "m2",
        senderName: "Grace Hopper",
        createdAt: "2026-03-03T09:14:00Z",
      }),
      message({
        messageId: "m1",
        senderName: "Ada Lovelace",
        createdAt: "2026-03-01T08:00:00Z",
      }),
    ];
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({ messages, selection: "messages", limit: undefined }),
      ]),
      [TRANSCRIPT],
    );

    const [group] = preview!.groups;
    expect(group.defaultCollapsed).toBe(false);
    expect(transcriptRow(group).file).toMatchObject({
      displayName: "Selected messages",
    });
    expect(threadRows(group).map((row) => row.label)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    // Nothing here can be taken back out of an uploaded transcript, so the
    // cards carry no inclusion toggle.
    expect(threadRows(group).every((row) => row.onToggle === undefined)).toBe(
      true,
    );
  });

  it("shows an excerpt so two messages from one sender are distinguishable", () => {
    const messages = [
      message({
        messageId: "m2",
        createdAt: "2026-03-03T09:14:00Z",
        text: "Actually Friday works better.",
      }),
      message({
        messageId: "m1",
        createdAt: "2026-03-01T08:00:00Z",
        text: "Can we move the sync to Thursday?",
      }),
    ];
    const preview = buildTeamsAttachmentGroups(
      attach([chatSection({ messages, selection: "messages" })]),
      [TRANSCRIPT],
    );

    const rows = threadRows(preview!.groups[0]);
    expect(rows[0].sublabel).toContain("Can we move the sync to Thursday?");
    expect(rows[1].sublabel).toContain("Actually Friday works better.");
  });

  it("truncates a long excerpt and flattens its whitespace", () => {
    const messages = [
      message({
        messageId: "m2",
        createdAt: "2026-03-03T09:14:00Z",
        text: "line one\n\n  line two",
      }),
      message({
        messageId: "m1",
        createdAt: "2026-03-01T08:00:00Z",
        text: `A${"b".repeat(200)}`,
      }),
    ];
    const preview = buildTeamsAttachmentGroups(
      attach([chatSection({ messages, selection: "messages" })]),
      [TRANSCRIPT],
    );

    const rows = threadRows(preview!.groups[0]);
    expect(rows[0].sublabel).toContain(`A${"b".repeat(99)}…`);
    expect(rows[0].sublabel).not.toContain("b".repeat(101));
    expect(rows[1].sublabel).toContain("line one line two");
  });

  it("keeps one group per conversation across chats and channels", () => {
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({
          selection: "messages",
          // Newest first, as Graph hands chat messages back; rendered oldest first.
          messages: [
            message({
              messageId: "k2",
              senderName: "Grace Hopper",
              createdAt: "2026-03-03T09:05:00Z",
            }),
            message({
              messageId: "k1",
              senderName: "Ada Lovelace",
              createdAt: "2026-03-03T09:00:00Z",
            }),
          ],
        }),
        {
          kind: "channel",
          channel,
          messages: [
            message({
              messageId: "c1",
              senderName: "Tom Weber",
              createdAt: "2026-03-04T10:00:00Z",
            }),
            message({
              messageId: "c2",
              senderName: "Anna Roth",
              createdAt: "2026-03-04T10:20:00Z",
            }),
          ],
          selection: "messages",
        },
      ]),
      [TRANSCRIPT],
    );

    expect(preview!.groups).toHaveLength(2);
    expect(preview!.groups.map((group) => group.label)).toEqual([
      "Product sync",
      "Releases · Contoso",
    ]);
    // The index is one flat array tagged by section, so a wrong partition
    // silently merges every conversation into every card. Assert membership,
    // not just the group count.
    expect(threadRows(preview!.groups[0]).map((row) => row.label)).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    expect(threadRows(preview!.groups[1]).map((row) => row.label)).toEqual([
      "Tom Weber",
      "Anna Roth",
    ]);
    expect(preview!.groups[0].metaLabel).toContain("2 messages");
    expect(preview!.groups[1].metaLabel).toContain("2 messages");
    // Both cards stand for slices of the same upload.
    for (const group of preview!.groups) {
      expect(transcriptRow(group).file).toMatchObject({ id: TRANSCRIPT.id });
    }
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("nests a message's uploads under it, joined by the stamped filename", () => {
    const image = upload("teams-img-abc.png", "upload-image");
    const shared = upload("teams-file-abc-report.pdf", "upload-report");
    const unrelated = upload("holiday.pdf", "upload-holiday");
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({
          selection: "messages",
          messages: [
            message({ messageId: "m2", createdAt: "2026-03-02T08:00:00Z" }),
            message({
              messageId: "m1",
              createdAt: "2026-03-01T08:00:00Z",
              text: "Here it is [image: teams-img-abc.png]",
              markers: ["[attachment: teams-file-abc-report.pdf]"],
            }),
          ],
        }),
      ]),
      [TRANSCRIPT, image, shared, unrelated],
    );

    const rows = threadRows(preview!.groups[0]);
    // Named for a reader, not by the minted upload name: the image has no name
    // of its own, and the shared file keeps the one the transcript recorded.
    expect(rows[0].attachments.map((item) => item.file)).toEqual([
      { id: image.id, filename: image.filename, displayName: "Image" },
      {
        id: shared.id,
        filename: shared.filename,
        displayName: shared.filename,
      },
    ]);
    expect(rows[1].attachments).toEqual([]);
    // The unrelated upload stays a flat chip, the joined ones do not.
    expect([...preview!.claimedFileIds].sort()).toEqual([
      image.id,
      shared.id,
      TRANSCRIPT.id,
    ]);
  });

  it("ignores a bare marker that happens to name one of the user's own files", () => {
    const own = upload("report.pdf", "upload-own");
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({
          selection: "messages",
          // Never fetched, so the marker still carries the Teams-side name.
          messages: [message({ markers: ["[attachment: report.pdf]"] })],
        }),
      ]),
      [TRANSCRIPT, own],
    );

    expect(threadRows(preview!.groups[0])[0].attachments).toEqual([]);
    expect([...preview!.claimedFileIds]).toEqual([TRANSCRIPT.id]);
  });

  it("lists a whole conversation's uploads beside its summary row", () => {
    const image = upload("teams-img-abc.png", "upload-image");
    const preview = buildTeamsAttachmentGroups(
      attach([
        chatSection({
          messages: [
            message({
              text: "Screenshot [image: teams-img-abc.png]",
            }),
            // The same asset in a second message must not double up.
            message({
              messageId: "m2",
              text: "Again [image: teams-img-abc.png]",
            }),
          ],
        }),
      ]),
      [TRANSCRIPT, image],
    );

    const [group] = preview!.groups;
    expect(itemKinds(group)).toEqual(["attachment", "attachment"]);
    expect(group.items[1]).toMatchObject({ id: image.id, file: image });
  });

  it("reports how many messages could not be loaded", () => {
    const preview = buildTeamsAttachmentGroups(
      attach([chatSection({ selection: "messages", skippedCount: 2 })]),
      [TRANSCRIPT],
    );

    expect(transcriptRow(preview!.groups[0]).file).toMatchObject({
      displayName: "Selected messages · 2 could not be loaded",
    });
  });
});
