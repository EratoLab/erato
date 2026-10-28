import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
} from "@/test/teamsTranscriptFixtures";

import { TeamsTranscriptDetail } from "./TeamsTranscriptDetail";

import type { TeamsTranscriptDetailProps } from "./TeamsTranscriptDetail";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

afterEach(cleanup);

const upload = (filename: string, id: string, size: number) =>
  ({ id, filename, size }) as unknown as FileUploadItem;

const roadmap = upload(
  "teams-file-1a2b3c4d-roadmap-q1.pdf",
  "u-roadmap",
  1_153_434,
);
const shot = upload("teams-img-0123456789abcdef.png", "u-shot", 245_760);
const wireframes = upload(
  "teams-file-9a8b7c6d-wireframes-v2.pdf",
  "u-wire",
  3_565_158,
);

const index = teamsIndex(
  [
    teamsSection({
      window: { from: "2026-10-01T12:00:00Z", to: "2026-10-14T12:00:00Z" },
    }),
    teamsSection({
      kind: "channel",
      title: "Design review",
      teamName: "Platform Team",
      ref: { kind: "channel", teamId: "t1", channelId: "c1" },
    }),
    teamsSection({
      title: "Grace Hopper",
      selection: "messages",
      viewer: "Ada Lovelace",
      ref: { kind: "chat", chatId: "19:grace" },
    }),
  ],
  [
    teamsMessage("m1", {
      createdAt: "2026-10-02T12:00:00Z",
      text: "Roadmap [attachment: teams-file-1a2b3c4d-roadmap-q1.pdf] and [image: teams-img-0123456789abcdef.png]",
      assets: [
        { name: roadmap.filename, displayName: "roadmap-q1.pdf", kind: "file" },
        {
          name: shot.filename,
          displayName: "dashboard-screenshot.png",
          kind: "image",
        },
      ],
    }),
    teamsMessage("m2", {
      section: 1,
      sender: "Alan Turing",
      assets: [
        {
          name: wireframes.filename,
          displayName: "wireframes-v2.pdf",
          kind: "file",
        },
      ],
    }),
    teamsMessage("m3", {
      section: 2,
      sender: "Grace Hopper",
      text: "The vendor wants the signed copy",
    }),
    teamsMessage("m4", { section: 2, text: "Sending it today" }),
  ],
);

/** Plays the host: a removed file leaves the staged list. */
function Host(props: Partial<TeamsTranscriptDetailProps>) {
  const [assets, setAssets] = useState<FileUploadItem[]>([
    roadmap,
    shot,
    wireframes,
  ]);
  return (
    <TeamsTranscriptDetail
      index={index}
      assets={assets}
      locked={false}
      {...props}
      onRemoveFile={(id) => {
        props.onRemoveFile?.(id);
        setAssets((current) => current.filter((file) => file.id !== id));
      }}
    />
  );
}

const wrap = (ui: React.ReactElement) =>
  render(
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

const renderDetail = (props: Partial<TeamsTranscriptDetailProps> = {}) =>
  wrap(<Host {...props} />);

const root = () =>
  document.querySelector<HTMLElement>('[data-ui="teams-transcript-detail"]')!;
const sections = () => [
  ...document.querySelectorAll<HTMLElement>(
    '[data-ui="teams-transcript-section"]',
  ),
];

describe("TeamsTranscriptDetail", () => {
  it("shows each conversation with what it contributes", () => {
    renderDetail();
    expect(root()).toHaveAttribute("data-view", "sections");
    expect(
      screen.getByText("One file covers all 3 conversations"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent),
    ).toEqual([
      "Product sync",
      "Design review · Platform Team",
      "Grace Hopper",
    ]);
    const [first, second, third] = sections();
    expect(first).toHaveAttribute("data-selection", "whole-chat");
    expect(second).toHaveAttribute("data-kind", "channel");
    expect(third).toHaveAttribute("data-selection", "messages");
    expect(
      within(first).getByText("1 message · Oct 1, 2026 – Oct 14, 2026"),
    ).toBeInTheDocument();
    expect(within(first).getByText("All messages · Chat")).toBeInTheDocument();
    expect(
      within(second).getByText("All messages · Channel"),
    ).toBeInTheDocument();

    const picked = third.querySelector('[data-ui="teams-transcript-picked"]')!;
    expect(
      within(picked as HTMLElement)
        .getAllByRole("listitem")
        .map((item) => item.querySelector("span")?.textContent),
    ).toEqual(["Grace Hopper", "You"]);
    expect(
      first.querySelector('[data-ui="teams-transcript-picked"]'),
    ).toBeNull();
  });

  it("leaves out the covering line for one conversation", () => {
    wrap(
      <TeamsTranscriptDetail
        index={teamsIndex([teamsSection()], [teamsMessage("m1")])}
        assets={[]}
        locked={false}
        onRemoveFile={vi.fn()}
      />,
    );
    expect(screen.queryByText(/One file covers/)).toBeNull();
    expect(sections()).toHaveLength(1);
  });

  it("previews a file under the name Teams gave it, with its remove always in view", () => {
    const onFilePreview = vi.fn();
    renderDetail({ onFilePreview });
    const files = screen.getByRole("list", {
      name: "Shared files in Product sync",
    });
    expect(files).toHaveAttribute("data-ui", "teams-transcript-files");
    fireEvent.click(
      within(files).getByRole("button", {
        name: "Preview attachment roadmap-q1.pdf, PDF · 1.1 MB",
      }),
    );
    expect(onFilePreview).toHaveBeenCalledWith({
      ...roadmap,
      displayName: "roadmap-q1.pdf",
    });

    const removes = within(files).getAllByRole("button", { name: /^Remove / });
    expect(removes.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Remove roadmap-q1.pdf",
      "Remove dashboard-screenshot.png",
    ]);
    for (const button of removes) {
      expect(button).toHaveAttribute("data-ui", "attachment-remove");
      expect(button.className).not.toContain("opacity-0");
      expect(button.closest("li")).not.toBeNull();
    }
  });

  it("removes a file, says so and moves focus to the next row, then the previous, then the conversation", () => {
    const onRemoveFile = vi.fn();
    renderDetail({ onRemoveFile });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove roadmap-q1.pdf" }),
    );
    expect(onRemoveFile).toHaveBeenCalledWith("u-roadmap");
    expect(
      document.querySelector('[data-ui="teams-transcript-detail-live"]'),
    ).toHaveTextContent("roadmap-q1.pdf removed.");
    const next = screen.getByRole("button", {
      name: "Remove dashboard-screenshot.png",
    });
    expect(next).toHaveFocus();

    fireEvent.click(next);
    expect(
      screen.getByRole("button", {
        name: "Open conversation: Product sync",
      }),
    ).toHaveFocus();
    expect(
      sections()[0].querySelector('[data-ui="teams-transcript-files"]'),
    ).toBeNull();
  });

  it("disables every remove while the item is locked", () => {
    renderDetail({ locked: true, onFilePreview: vi.fn() });
    for (const button of screen.getAllByRole("button", { name: /^Remove / })) {
      expect(button).toBeDisabled();
    }
    expect(
      screen.getByRole("button", { name: /^Preview attachment roadmap/ }),
    ).toBeEnabled();
  });

  it("swaps in a conversation and returns to its section", () => {
    const onFilePreview = vi.fn();
    renderDetail({ onFilePreview });
    const open = screen.getByRole("button", {
      name: "Open conversation: Product sync",
    });
    expect(open).toHaveAttribute(
      "data-ui",
      "teams-transcript-open-conversation",
    );
    expect(open).toHaveTextContent("Open conversation");
    fireEvent.click(open);

    expect(root()).toHaveAttribute("data-view", "conversation");
    const back = screen.getByRole("button", { name: "All conversations" });
    expect(back).toHaveAttribute("data-ui", "teams-transcript-back");
    expect(back).toHaveFocus();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Product sync",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Preview attachment dashboard-screenshot\.png/,
      }),
    );
    expect(onFilePreview).toHaveBeenCalledWith({
      ...shot,
      displayName: "dashboard-screenshot.png",
    });

    fireEvent.click(back);
    expect(root()).toHaveAttribute("data-view", "sections");
    expect(
      screen.getByRole("button", { name: "Open conversation: Product sync" }),
    ).toHaveFocus();
  });

  it("still lists the files of a transcript it can't read", () => {
    const onRemoveFile = vi.fn();
    wrap(
      <TeamsTranscriptDetail
        index={null}
        assets={[roadmap, shot]}
        locked={false}
        onRemoveFile={onRemoveFile}
      />,
    );
    expect(root()).toHaveAttribute("data-view", "unreadable");
    expect(
      screen.getByText(
        "This transcript is still sent, but its conversations can't be shown here.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove roadmap-q1.pdf" }),
    );
    expect(onRemoveFile).toHaveBeenCalledWith("u-roadmap");
    expect(
      screen.getByRole("button", { name: "Remove Image.png" }),
    ).toBeInTheDocument();
  });

  it("keeps focus inside when the last file of an unreadable transcript goes", () => {
    renderDetail({ index: null });
    for (const name of [
      "Remove roadmap-q1.pdf",
      "Remove Image.png",
      "Remove wireframes-v2.pdf",
    ]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(root()).toHaveFocus();
  });

  it("says it is still reading rather than that it can't read", () => {
    wrap(
      <TeamsTranscriptDetail
        index={null}
        reading
        assets={[roadmap]}
        locked={false}
        onRemoveFile={vi.fn()}
      />,
    );
    expect(root()).toHaveAttribute("data-view", "reading");
    expect(screen.getByText("Reading transcript…")).toBeInTheDocument();
    expect(screen.queryByText(/can't be shown here/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove roadmap-q1.pdf" }),
    ).toBeInTheDocument();
  });

  it("lists a section's files before its picked messages", () => {
    const picked = teamsIndex(
      [teamsSection({ selection: "messages" })],
      [
        teamsMessage("m1", {
          assets: [
            {
              name: roadmap.filename,
              displayName: "roadmap-q1.pdf",
              kind: "file",
            },
          ],
        }),
      ],
    );
    renderDetail({ index: picked });
    const [section] = sections();
    const files = section.querySelector('[data-ui="teams-transcript-files"]')!;
    const messages = section.querySelector(
      '[data-ui="teams-transcript-picked"]',
    )!;
    expect(
      files.compareDocumentPosition(messages) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("speaks a second removal that reads like the first", () => {
    const first = upload("teams-img-1111111111111111.png", "u-1", 10);
    const second = upload("teams-img-2222222222222222.png", "u-2", 10);
    const pasted = teamsIndex(
      [teamsSection()],
      [
        teamsMessage("m1", {
          assets: [
            { name: first.filename, displayName: null, kind: "image" },
            { name: second.filename, displayName: null, kind: "image" },
          ],
        }),
      ],
    );
    function TwoImages() {
      const [assets, setAssets] = useState([first, second]);
      return (
        <TeamsTranscriptDetail
          index={pasted}
          assets={assets}
          locked={false}
          onRemoveFile={(id) =>
            setAssets((current) => current.filter((file) => file.id !== id))
          }
        />
      );
    }
    wrap(<TwoImages />);
    const region = document.querySelector(
      '[data-ui="teams-transcript-detail-live"]',
    )!;
    fireEvent.click(screen.getAllByRole("button", { name: "Remove Image" })[0]);
    const spoken = region.textContent;
    expect(spoken).toBe("Image removed.");
    fireEvent.click(screen.getByRole("button", { name: "Remove Image" }));
    expect(region.textContent).not.toBe(spoken);
    expect(region.textContent).toContain("Image removed.");
  });

  it("lists staged uploads no conversation names under other shared files", () => {
    const notes = upload("teams-file-0f0f0f0f-notes.txt", "u-notes", 2_048);
    const onRemoveFile = vi.fn();
    wrap(
      <TeamsTranscriptDetail
        index={index}
        assets={[roadmap, shot, wireframes, notes]}
        locked={false}
        onRemoveFile={onRemoveFile}
      />,
    );
    const others = document.querySelector<HTMLElement>(
      '[data-ui="teams-transcript-other-files"]',
    )!;
    expect(within(others).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Other shared files",
    );
    fireEvent.click(
      within(others).getByRole("button", { name: "Remove notes.txt" }),
    );
    expect(onRemoveFile).toHaveBeenCalledWith("u-notes");
    expect(
      within(sections()[0]).queryByRole("button", { name: "Remove notes.txt" }),
    ).toBeNull();
  });

  it("says which conversation's files the composer did not take", () => {
    wrap(
      <TeamsTranscriptDetail
        index={index}
        assets={[roadmap, shot]}
        notAttached={[wireframes.filename]}
        locked={false}
        onRemoveFile={vi.fn()}
      />,
    );
    const [first, second] = sections();
    expect(
      within(second).getByText("1 shared file not attached"),
    ).toHaveAttribute("data-ui", "teams-transcript-not-attached");
    expect(
      first.querySelector('[data-ui="teams-transcript-not-attached"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-ui="teams-transcript-other-files"]'),
    ).toBeNull();
  });
});
