import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { messages as enMessages } from "@/locales/en/messages.json";
import {
  TEAMS_TRANSCRIPT_INDEX_MARKER,
  TEAMS_TRANSCRIPT_INDEX_VERSION,
} from "@/utils/teams/teamsTranscriptIndex";

import { TeamsTranscriptPreview } from "./TeamsTranscriptPreview";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { TeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";
import type { Messages } from "@lingui/core";
import type React from "react";

/** MessageTimestamp formats through lingui, so the catalogue has to be live. */
async function renderPreview(ui: React.ReactElement) {
  const { i18n } = await import("@lingui/core");
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider>{ui}</ThemeProvider>
    </I18nProvider>,
  );
}

const FILE = {
  filename: "teams-Product_sync.md",
  url: "https://files.example.com/teams-Product_sync.md",
};

const conversation = { kind: "chat", chatId: "19:chat" } as const;

const INDEX: TeamsTranscriptIndex = {
  version: TEAMS_TRANSCRIPT_INDEX_VERSION,
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
    },
  ],
  messages: [
    {
      ordinal: 1,
      section: 0,
      ref: { conversation, messageId: "m1", parentMessageId: null },
      sender: "Ada Lovelace",
      createdAt: "2026-03-01T08:00:00Z",
      editedAt: null,
      subject: null,
      deepLink: "https://teams.microsoft.com/l/message/19:chat/m1",
      text: "Can we move the sync? [attachment: teams-file-abcd1234-plan.pdf]",
      assets: [
        {
          name: "teams-file-abcd1234-plan.pdf",
          displayName: "Q3 plan.pdf",
          kind: "file",
        },
      ],
    },
  ],
};

/** A transcript as the add-in writes one: prose, then the trailing block. */
function transcript(index: TeamsTranscriptIndex = INDEX): string {
  return [
    "# Teams chat: Product sync",
    "",
    "[1] Ada Lovelace (08:00): Can we move the sync?",
    "",
    `<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v${index.version} ${JSON.stringify(index)} -->`,
    "",
  ].join("\n");
}

function respondWith(body: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        text: () => Promise.resolve(body),
      } as unknown as Response),
    ),
  );
}

vi.mock("./PdfPreview", () => ({
  PdfPreview: ({ url }: { url: string }) => (
    <div data-testid="file-preview-pdf" data-url={url} />
  ),
}));

describe("TeamsTranscriptPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the stored transcript as its conversation", async () => {
    respondWith(transcript());
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    expect(await screen.findByText("Product sync")).toBeVisible();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Can we move the sync?")).toBeVisible();
    expect(screen.getByText("Ada Lovelace, Grace Hopper")).toBeVisible();
  });

  it("names the uploads a message carried, never by their stored name", async () => {
    respondWith(transcript());
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    expect(await screen.findByText(/Q3 plan/)).toBeVisible();
    expect(screen.queryByText(/teams-file-abcd1234/)).toBeNull();
  });

  it("leaves the chips inert when the caller has no sibling files", async () => {
    respondWith(transcript());
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    await screen.findByText(/Q3 plan/);
    expect(screen.queryByRole("button", { name: /Q3 plan/ })).toBeNull();
  });

  it("opens an upload the transcript names, joined by filename", async () => {
    // The transcript records only names; the bytes live in the sibling upload,
    // so the chip is clickable exactly when the caller supplies it.
    const upload = {
      id: "upload-1",
      filename: "teams-file-abcd1234-plan.pdf",
      download_url: "https://files.example.com/download/plan.pdf",
      preview_url: "https://files.example.com/preview/plan.pdf",
      file_capability: { mime_types: ["application/pdf"] },
    } as unknown as FileUploadItem;

    respondWith(transcript());
    await renderPreview(
      <TeamsTranscriptPreview {...FILE} relatedFiles={[upload]} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Q3 plan/ }));

    // Navigates in place, as the email preview does, with a way back.
    expect(
      screen.getByRole("button", { name: /back to conversation/i }),
    ).toBeVisible();
    // The PDF viewer is lazy-loaded behind Suspense.
    expect(await screen.findByTestId("file-preview-pdf")).toHaveAttribute(
      "data-url",
      "https://files.example.com/preview/plan.pdf",
    );
  });

  it("reveals the message a citation's #msg anchor names", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    respondWith(transcript());
    const { container } = await renderPreview(
      <TeamsTranscriptPreview {...FILE} url={`${FILE.url}#msg=1`} />,
    );

    await screen.findByText("Product sync");
    expect(container.querySelector('[data-ordinal="1"]')).toHaveClass("ring-2");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("falls back to the markdown when the file carries no block", async () => {
    // The dead end this replaces was "Preview is not available"; plain text
    // beats it even for a file that was never a transcript.
    respondWith("# Notes\n\nJust an ordinary markdown file.\n");
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    expect(
      await screen.findByText(/Just an ordinary markdown file/),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
  });

  it("falls back to the markdown when the block cannot be read", async () => {
    respondWith(
      `# Teams chat\n\n<!-- ${TEAMS_TRANSCRIPT_INDEX_MARKER} v1 {"sections": -->\n`,
    );
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    expect(await screen.findByText(/Teams chat/)).toBeVisible();
  });

  it("says so when the file cannot be fetched at all", async () => {
    respondWith("", false);
    await renderPreview(<TeamsTranscriptPreview {...FILE} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be loaded/i,
    );
  });

  it("re-reads when the modal moves to another file", async () => {
    respondWith(transcript());
    const { rerender } = await renderPreview(
      <TeamsTranscriptPreview {...FILE} />,
    );
    await screen.findByText("Product sync");

    respondWith(
      transcript({
        ...INDEX,
        sections: [{ ...INDEX.sections[0], title: "Design review" }],
      }),
    );
    const { i18n } = await import("@lingui/core");
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider>
          <TeamsTranscriptPreview
            filename="teams-Design_review.md"
            url="https://files.example.com/teams-Design_review.md"
          />
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Design review")).toBeVisible(),
    );
    expect(screen.queryByText("Product sync")).toBeNull();
  });
});
