import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";

import { DefaultTeamsConversationView } from "./TeamsConversationView";

import type {
  TeamsTranscriptIndex,
  TeamsTranscriptIndexMessage,
} from "@/utils/teams/teamsTranscriptIndex";
import type { Messages } from "@lingui/core";

async function renderView(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");

  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider
        enableCustomTheme={false}
        initialThemeMode="light"
        persistThemeMode={false}
      >
        {ui}
      </ThemeProvider>
    </I18nProvider>,
  );
}

const conversation = { kind: "chat", chatId: "19:chat" } as const;

const REPORT_ASSET = {
  name: "teams-file-d72e2945-report.pdf",
  displayName: "Q3 report.pdf",
  kind: "file" as const,
};

function message(
  ordinal: number,
  overrides: Partial<TeamsTranscriptIndexMessage> = {},
): TeamsTranscriptIndexMessage {
  return {
    ordinal,
    section: 0,
    ref: {
      conversation,
      messageId: `m${ordinal}`,
      parentMessageId: null,
    },
    sender: "Ada Lovelace",
    createdAt: "2026-03-01T08:00:00Z",
    editedAt: null,
    subject: null,
    deepLink: `https://teams.microsoft.com/l/message/19:chat/m${ordinal}`,
    text: `Message ${ordinal}`,
    assets: [],
    ...overrides,
  };
}

function index(
  messages: TeamsTranscriptIndexMessage[],
  overrides: Partial<TeamsTranscriptIndex["sections"][number]> = {},
): TeamsTranscriptIndex {
  return {
    version: 1,
    exportedAt: "2026-03-02T00:00:00Z",
    timeZone: "UTC",
    sections: [
      {
        kind: "chat",
        ref: conversation,
        title: "Product sync",
        teamName: null,
        selection: "whole-chat",
        limit: 200,
        truncated: false,
        skippedCount: 0,
        window: { from: "2026-03-01T08:00:00Z", to: "2026-03-01T08:00:00Z" },
        participants: ["Ada Lovelace", "Grace Hopper"],
        viewer: "Grace Hopper",
        ...overrides,
      },
    ],
    messages,
  };
}

describe("TeamsConversationView", () => {
  it("shows the conversation header, participants and window", async () => {
    await renderView(
      <DefaultTeamsConversationView index={index([message(1)])} />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Product sync",
    );
    expect(screen.getByText("Ada Lovelace, Grace Hopper")).toBeVisible();
  });

  it("collapses a run of messages from one speaker under a single name", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([
          message(1),
          message(2),
          message(3, { sender: "Grace Hopper" }),
          message(4),
        ])}
      />,
    );

    // Ada speaks twice, then again after Grace: two runs, not three headers.
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
    expect(screen.getAllByText("Grace Hopper")).toHaveLength(1);
    expect(screen.getByText("Message 1")).toBeVisible();
    expect(screen.getByText("Message 2")).toBeVisible();
  });

  it("splits speaker runs across a day divider", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([
          message(1),
          message(2, { createdAt: "2026-03-04T09:00:00Z" }),
        ])}
      />,
    );

    // Same sender, different days: the divider forces a fresh run.
    expect(screen.getAllByText("Ada Lovelace")).toHaveLength(2);
  });

  it("names assets from the index instead of the minted upload name", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([
          message(1, {
            text: "Here you go [attachment: teams-file-d72e2945-report.pdf]",
            assets: [
              {
                name: "teams-file-d72e2945-report.pdf",
                displayName: "Q3 report.pdf",
                kind: "file",
              },
            ],
          }),
        ])}
      />,
    );

    expect(screen.getByText(/Q3 report/)).toBeVisible();
    expect(screen.queryByText(/teams-file-d72e2945/)).toBeNull();
    // The marker is dropped from the body — the chip below already says it.
    expect(screen.getByText("Here you go")).toBeVisible();
  });

  it("labels a pasted image that never had a name", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([
          message(1, {
            text: "[image: teams-img-abc123.png]",
            assets: [
              {
                name: "teams-img-abc123.png",
                displayName: null,
                kind: "image",
              },
            ],
          }),
        ])}
      />,
    );

    expect(screen.getByText(/Image/)).toBeVisible();
    expect(screen.queryByText(/teams-img-abc123/)).toBeNull();
  });

  it("opens a message in Teams through the callback", async () => {
    const onOpenInTeams = vi.fn();
    await renderView(
      <DefaultTeamsConversationView
        index={index([message(1)])}
        onOpenInTeams={onOpenInTeams}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open in teams/i }));
    expect(onOpenInTeams).toHaveBeenCalledWith(
      expect.objectContaining({ ordinal: 1 }),
    );
  });

  it("renders no Teams link when the caller cannot follow one", async () => {
    await renderView(
      <DefaultTeamsConversationView index={index([message(1)])} />,
    );

    expect(screen.queryByRole("button", { name: /open in teams/i })).toBeNull();
  });

  it("leaves an asset inert while the caller cannot resolve it", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([message(1, { assets: [REPORT_ASSET] })])}
        onFilePreview={vi.fn()}
      />,
    );

    expect(screen.getByText(/Q3 report/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /Q3 report/ })).toBeNull();
  });

  it("previews the upload the caller resolved, not the index entry", async () => {
    const onFilePreview = vi.fn();
    const resolved = {
      id: "upload-1",
      filename: "teams-file-d72e2945-report.pdf",
    };

    await renderView(
      <DefaultTeamsConversationView
        index={index([message(1, { assets: [REPORT_ASSET] })])}
        onFilePreview={onFilePreview}
        resolveAsset={() => resolved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Q3 report/ }));
    expect(onFilePreview).toHaveBeenCalledWith(resolved);
  });

  it("renders only the requested section", async () => {
    const twoSections: TeamsTranscriptIndex = {
      ...index([message(1), message(2, { section: 1, sender: "Alan Turing" })]),
      sections: [
        index([]).sections[0],
        { ...index([]).sections[0], title: "Design review" },
      ],
    };

    await renderView(
      <DefaultTeamsConversationView index={twoSections} sectionIndex={1} />,
    );

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Design review",
    );
    expect(screen.getByText("Alan Turing")).toBeVisible();
    expect(screen.queryByText("Message 1")).toBeNull();
  });

  it("says when history was cut short or messages were lost", async () => {
    await renderView(
      <DefaultTeamsConversationView
        index={index([message(1)], { truncated: true, skippedCount: 2 })}
      />,
    );

    const header = screen.getByRole("heading", { level: 2 }).parentElement;
    expect(header).not.toBeNull();
    expect(
      within(header as HTMLElement).getByText(
        /older messages are not included/i,
      ),
    ).toBeVisible();
    expect(
      within(header as HTMLElement).getByText(
        /2 messages could not be loaded/i,
      ),
    ).toBeVisible();
  });
});
