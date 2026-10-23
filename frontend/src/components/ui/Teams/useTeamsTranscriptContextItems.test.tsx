import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { readTeamsTranscriptIndex } from "@/hooks/teams/useTeamsTranscriptIndex";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
  teamsTranscriptFile,
} from "@/test/teamsTranscriptFixtures";

import { useTeamsTranscriptContextItems } from "./useTeamsTranscriptContextItems";

import type {
  TeamsTranscriptContextEntry,
  TeamsTranscriptContextOptions,
} from "./useTeamsTranscriptContextItems";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const upload = (filename: string, id: string) =>
  ({ id, filename }) as FileUploadItem;

const transcriptUpload = upload("teams-chats-3.md", "u-transcript");
const roadmap = upload("teams-file-1a2b3c4d-roadmap-q1.pdf", "u-roadmap");
const shot = upload("teams-img-0123456789abcdef.png", "u-shot");

const threeConversations = () =>
  teamsTranscriptFile(
    teamsIndex(
      [
        teamsSection(),
        teamsSection({ title: "Design review" }),
        teamsSection({ title: "Grace Hopper" }),
      ],
      [teamsMessage("m1"), teamsMessage("m2", { section: 1 })],
    ),
    transcriptUpload.filename,
  );

const entryFor = (
  transcript: File,
  over: Partial<TeamsTranscriptContextEntry> = {},
): TeamsTranscriptContextEntry => ({
  id: "lineage-1",
  transcript,
  uploads: { transcript: transcriptUpload, assets: [roadmap, shot] },
  onRemove: vi.fn(),
  onEditSelection: vi.fn(),
  ...over,
});

const options: TeamsTranscriptContextOptions = {
  onRemoveFile: vi.fn(),
  onFilePreview: vi.fn(),
};

describe("useTeamsTranscriptContextItems", () => {
  it("makes one user item per transcript that claims exactly its staged uploads", async () => {
    const transcript = threeConversations();
    await readTeamsTranscriptIndex(transcript);
    const entry = entryFor(transcript);
    const { result } = renderHook(() =>
      useTeamsTranscriptContextItems([entry], options),
    );
    const [item] = result.current;
    expect(result.current).toHaveLength(1);
    expect(item).toMatchObject({
      id: "teams.transcript:lineage-1",
      kind: "teams.transcript",
      origin: "user",
      state: "included",
      icon: "chats",
      label: "Product sync +2",
      meta: "3 conversations · 2 messages",
      spokenLabel: "Teams transcript",
      removeLabel: "Remove Teams transcript",
      removeActionLabel: "Remove transcript",
      claimsFileIds: ["u-transcript", "u-roadmap", "u-shot"],
      announcements: {
        removed: "Teams transcript removed, with 2 shared files.",
      },
      onRemove: entry.onRemove,
    });
    expect(item.estimate).toBeUndefined();
    expect(item.detail?.title).toBe("Teams transcript");
    expect(item.detail?.actions).toEqual([
      {
        id: "teams.editSelection",
        label: "Edit selection",
        variant: "primary",
        onSelect: entry.onEditSelection,
      },
    ]);
  });

  it("says a plain removal without files and drops Edit selection where the picker can't run", async () => {
    const transcript = threeConversations();
    await readTeamsTranscriptIndex(transcript);
    const { result } = renderHook(() =>
      useTeamsTranscriptContextItems(
        [
          entryFor(transcript, {
            uploads: { transcript: transcriptUpload, assets: [roadmap] },
          }),
          entryFor(transcript, {
            id: "lineage-2",
            uploads: { transcript: transcriptUpload, assets: [] },
            onEditSelection: undefined,
          }),
        ],
        options,
      ),
    );
    const [one, none] = result.current;
    expect(one.announcements?.removed).toBe(
      "Teams transcript removed, with 1 shared file.",
    );
    expect(none.announcements?.removed).toBe("Teams transcript removed.");
    expect(none.claimsFileIds).toEqual(["u-transcript"]);
    expect(none.detail?.actions).toEqual([]);
  });

  it("is loading until the transcript is read, then included", async () => {
    const transcript = threeConversations();
    const { result } = renderHook(() =>
      useTeamsTranscriptContextItems([entryFor(transcript)], options),
    );
    expect(result.current[0]).toMatchObject({
      state: "loading",
      label: "Teams transcript",
      meta: "Reading transcript…",
    });
    // The detail says the same while it reads, not that it can't.
    const reading = result.current[0].detail?.render({ locked: false }) as {
      props: { index: unknown; reading: boolean };
    };
    expect(reading.props).toMatchObject({ index: null, reading: true });
    await waitFor(() => expect(result.current[0].state).toBe("included"));
    expect(result.current[0].label).toBe("Product sync +2");
  });

  it("keeps its items and list while nothing they show changes", async () => {
    const transcript = threeConversations();
    await readTeamsTranscriptIndex(transcript);
    const entry = entryFor(transcript);
    const { result, rerender } = renderHook(
      ({ entries }) => useTeamsTranscriptContextItems(entries, options),
      { initialProps: { entries: [entry] } },
    );
    const first = result.current;
    rerender({ entries: [{ ...entry }] });
    expect(result.current).toBe(first);
    expect(result.current[0]).toBe(first[0]);

    rerender({
      entries: [
        { ...entry, uploads: { transcript: transcriptUpload, assets: [shot] } },
      ],
    });
    expect(result.current).not.toBe(first);
    expect(result.current[0].claimsFileIds).toEqual(["u-transcript", "u-shot"]);
    expect(result.current[0].id).toBe(first[0].id);
  });

  it("renders the detail with the lane's lock", async () => {
    const transcript = threeConversations();
    await readTeamsTranscriptIndex(transcript);
    const { result } = renderHook(() =>
      useTeamsTranscriptContextItems([entryFor(transcript)], options),
    );
    const body = result.current[0].detail?.render({ locked: true }) as {
      props: { locked: boolean; assets: FileUploadItem[] };
    };
    expect(body.props.locked).toBe(true);
    expect(body.props.assets).toEqual([roadmap, shot]);
    act(() => undefined);
  });

  it("hands the detail the files the composer did not take, and rebuilds when they change", async () => {
    const transcript = threeConversations();
    await readTeamsTranscriptIndex(transcript);
    const entry = entryFor(transcript, {
      notAttachedAssetNames: ["teams-file-ffffffff-gone.pdf"],
    });
    const { result, rerender } = renderHook(
      ({ entries }) => useTeamsTranscriptContextItems(entries, options),
      { initialProps: { entries: [entry] } },
    );
    const body = result.current[0].detail?.render({ locked: false }) as {
      props: { notAttached: readonly string[] };
    };
    expect(body.props.notAttached).toEqual(["teams-file-ffffffff-gone.pdf"]);

    const first = result.current[0];
    rerender({
      entries: [
        { ...entry, notAttachedAssetNames: ["teams-file-ffffffff-gone.pdf"] },
      ],
    });
    expect(result.current[0]).toBe(first);
    rerender({ entries: [{ ...entry, notAttachedAssetNames: [] }] });
    expect(result.current[0]).not.toBe(first);
  });
});
