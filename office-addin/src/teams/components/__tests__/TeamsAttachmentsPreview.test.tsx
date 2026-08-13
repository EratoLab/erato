import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamsAttachmentsPreview } from "../TeamsAttachmentsPreview";

import type { TeamsAttachedTranscript } from "../../utils/teamsAttachmentGroups";
import type {
  FileAttachmentGroup,
  FileAttachmentsPreviewProps,
  FileUploadItem,
  GroupedFileAttachmentsPreviewProps,
} from "@erato/frontend/library";

const state = vi.hoisted(() => ({
  attachedTranscript: null as TeamsAttachedTranscript | null,
}));

vi.mock("@erato/frontend/library", () => ({
  FileAttachmentsPreview: ({ attachedFiles }: FileAttachmentsPreviewProps) => (
    <div data-testid="flat-preview">
      {attachedFiles.map((file) => file.filename).join(",")}
    </div>
  ),
  GroupedFileAttachmentsPreview: ({
    groups,
  }: GroupedFileAttachmentsPreviewProps) => (
    <div data-testid="grouped-preview">
      {groups.map((group: FileAttachmentGroup) => (
        <div key={group.id} data-testid="group">
          {group.label}
        </div>
      ))}
    </div>
  ),
}));
vi.mock("../../providers/TeamsChatPickerProvider", () => ({
  useTeamsChatPicker: () => ({ attachedTranscript: state.attachedTranscript }),
}));

function upload(filename: string, id = filename): FileUploadItem {
  return { id, filename } as FileUploadItem;
}

const transcript = upload("teams-Product_sync.md", "upload-transcript");
const image = upload("teams-img-abc.png", "upload-image");
const unrelated = upload("holiday.pdf", "upload-holiday");

const attached: TeamsAttachedTranscript = {
  fileName: transcript.filename,
  sections: [
    {
      kind: "chat",
      chat: {
        chatId: "19:chat",
        title: "Product sync",
        participants: [],
        selfDisplayName: null,
        participantsTruncated: false,
        chatType: "group",
        lastActivityAt: null,
        previewText: "",
      },
      messages: [
        {
          chatId: "19:chat",
          messageId: "m1",
          senderName: "Ada Lovelace",
          createdAt: "2026-03-01T08:00:00Z",
          editedAt: null,
          subject: null,
          text: "Screenshot [image: attached as teams-img-abc.png]",
          markers: [],
          sharedFiles: [],
          imageUrls: [],
          replyToId: null,
          deepLink: "https://teams.microsoft.com/l/message/19:chat/m1",
        },
      ],
      selection: "messages",
    },
  ],
};

function renderPreview(
  attachedFiles: FileUploadItem[],
  overrides: Partial<FileAttachmentsPreviewProps> = {},
) {
  return render(
    <TeamsAttachmentsPreview
      attachedFiles={attachedFiles}
      maxFiles={50}
      onRemoveFile={() => {}}
      onRemoveAllFiles={() => {}}
      {...overrides}
    />,
  );
}

describe("TeamsAttachmentsPreview", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.attachedTranscript = null;
  });
  afterEach(cleanup);

  it("renders the composer's flat chips when no transcript is attached", () => {
    renderPreview([unrelated]);

    expect(screen.queryByTestId("grouped-preview")).toBeNull();
    expect(screen.getByTestId("flat-preview")).toHaveTextContent("holiday.pdf");
  });

  it("renders the conversation and leaves unrelated uploads as chips", () => {
    state.attachedTranscript = attached;
    renderPreview([transcript, image, unrelated]);

    expect(screen.getByTestId("group")).toHaveTextContent("Product sync");
    expect(screen.getByTestId("flat-preview")).toHaveTextContent("holiday.pdf");
    expect(screen.getByTestId("flat-preview")).not.toHaveTextContent(
      "teams-img-abc.png",
    );
  });
});
