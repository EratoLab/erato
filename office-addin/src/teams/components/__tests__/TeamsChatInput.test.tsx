import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as pickerModule from "../../providers/TeamsChatPickerProvider";
import { TeamsChatInput } from "../TeamsChatInput";

import type { TeamsTranscriptRecord } from "../../utils/teamsComposerTranscripts";
import type { TeamsComposerContextValue } from "../TeamsComposerContext";
import type {
  ComposerContextItem,
  FileUploadItem,
  TeamsTranscriptContextEntry,
  TeamsTranscriptContextOptions,
} from "@erato/frontend/library";
import type { Context, ReactNode } from "react";

const state = vi.hoisted(() => ({
  canPick: true,
  initialStaged: [] as FileUploadItem[],
  setFiles: null as
    | null
    | ((update: (files: FileUploadItem[]) => FileUploadItem[]) => void),
  renders: [] as string[][],
  entries: [] as readonly TeamsTranscriptContextEntry[],
  options: null as TeamsTranscriptContextOptions | null,
  composer: null as TeamsComposerContextValue | null,
  controls: {
    addUploadedFiles: (_files: FileUploadItem[]) => {},
    removeUploadedFiles: (_ids: string[]) => {},
    focusInput: () => {},
  },
}));

vi.mock("@erato/frontend/library", async () => {
  const React = await import("react");
  const { ContextLaneDouble } = await import(
    "../../../test/helpers/contextLaneDouble"
  );
  const { useTeamsComposer } = await import("../TeamsComposerContext");
  const mock = await import("../../../test/helpers/eratoLibraryMock");

  function ComposerProbe() {
    state.composer = useTeamsComposer();
    return null;
  }

  /** Holds the staged files and reports them the way ChatInput does. */
  function ChatInput({
    contextItems,
    onStagedFilesChange,
  }: {
    contextItems?: ComposerContextItem[];
    onStagedFilesChange?: (files: FileUploadItem[]) => void;
  }) {
    const [files, setFiles] = React.useState(state.initialStaged);
    state.setFiles = setFiles;
    state.renders.push((contextItems ?? []).map((item) => item.id));
    React.useLayoutEffect(() => {
      onStagedFilesChange?.(files);
    }, [files, onStagedFilesChange]);
    return (
      <>
        <ContextLaneDouble items={contextItems} />
        <ComposerProbe />
      </>
    );
  }

  return mock.createEratoLibraryMock({
    ChatInput,
    useChatInputControls: () => state.controls,
    // A recording stand-in for the library hook: the add-in's part is which
    // entries it builds, the item's own shape is the library's test.
    useTeamsTranscriptContextItems: (
      entries: readonly TeamsTranscriptContextEntry[],
      options: TeamsTranscriptContextOptions,
    ): ComposerContextItem[] => {
      state.options = options;
      state.entries = entries;
      return entries.map((entry) => ({
        id: `teams.transcript:${entry.id}`,
        kind: "teams.transcript",
        origin: "user",
        state: "included",
        label: entry.transcript.name,
        icon: "chats",
        claimsFileIds: [
          entry.uploads.transcript.id,
          ...entry.uploads.assets.map((file) => file.id),
        ],
        onRemove: entry.onRemove,
        removeLabel: "Remove Teams transcript",
        detail: {
          title: "Teams transcript",
          render: () => null,
          actions: entry.onEditSelection
            ? [
                {
                  id: "teams.editSelection",
                  label: "Edit selection",
                  onSelect: entry.onEditSelection,
                },
              ]
            : [],
        },
      }));
    },
  });
});

vi.mock("../../providers/TeamsChatPickerProvider", async () => {
  const React = await import("react");
  const TestPickerContext = React.createContext<unknown>(null);
  return {
    TestPickerContext,
    useTeamsChatPicker: () => React.useContext(TestPickerContext),
  };
});

vi.mock("../../hooks/useTeamsPickerAvailability", () => ({
  useTeamsPickerAvailability: () => ({
    available: true,
    capabilitiesReady: true,
    supportsMarkdown: true,
    canPick: state.canPick,
  }),
}));

const { TestPickerContext } = pickerModule as unknown as {
  TestPickerContext: Context<unknown>;
};

const upload = (id: string, filename = `${id}.pdf`) =>
  ({ id, filename }) as FileUploadItem;

const transcriptFile = new File(["#"], "teams-chats-2.md");
const record = (
  transcriptUploadId: string,
  assetUploadIds: string[],
  lineage = "lineage-1",
  names: { assetNames?: string[]; excludedAssetNames?: string[] } = {},
): TeamsTranscriptRecord => ({
  lineage,
  transcriptUploadId,
  assetUploadIds,
  assetNames: assetUploadIds.map((id) => `${id}.pdf`),
  excludedAssetNames: [],
  ...names,
  file: transcriptFile,
  selections: [],
  messageLimit: 200,
});

const picker = {
  forget: vi.fn(),
  open: vi.fn(),
  excludeAsset: vi.fn(),
};

let setRecords: (records: TeamsTranscriptRecord[]) => void = () => {};

function Picker({
  initial,
  children,
}: {
  initial: TeamsTranscriptRecord[];
  children: ReactNode;
}) {
  const [records, setState] = useState(initial);
  setRecords = setState;
  const transcripts = new Map(
    records.map((entry) => [entry.transcriptUploadId, entry]),
  );
  return (
    <TestPickerContext.Provider value={{ ...picker, transcripts }}>
      {children}
    </TestPickerContext.Provider>
  );
}

const onFilePreview = vi.fn();

function renderInput(
  records: TeamsTranscriptRecord[],
  staged: FileUploadItem[],
) {
  state.initialStaged = staged;
  return render(
    <Picker initial={records}>
      <TeamsChatInput onSendMessage={vi.fn()} onFilePreview={onFilePreview} />
    </Picker>,
  );
}

const chips = () => screen.queryAllByTestId("context-chip-teams.transcript");

describe("TeamsChatInput", () => {
  beforeEach(() => {
    i18n.activate("en");
    state.canPick = true;
    state.renders = [];
    state.composer = null;
    state.controls = {
      addUploadedFiles: vi.fn((files: FileUploadItem[]) =>
        state.setFiles?.((current) => [...current, ...files]),
      ),
      removeUploadedFiles: vi.fn((ids: string[]) =>
        state.setFiles?.((current) =>
          current.filter((file) => !ids.includes(file.id)),
        ),
      ),
      focusInput: vi.fn(),
    };
    picker.forget.mockReset();
    picker.open.mockReset();
    picker.excludeAsset.mockReset();
    onFilePreview.mockReset();
  });
  afterEach(cleanup);

  it("shows a chip only while the record's transcript is staged here", () => {
    renderInput([record("t1", ["a1"])], [upload("u")]);
    expect(chips()).toHaveLength(0);

    act(() =>
      state.setFiles?.(() => [
        upload("t1", "teams-chats-2.md"),
        upload("a1"),
        upload("u"),
      ]),
    );
    expect(chips()).toHaveLength(1);
    expect(chips()[0]).toHaveAttribute("data-id", "teams.transcript:lineage-1");

    // Another chat's draft, then back.
    act(() => state.setFiles?.(() => [upload("u")]));
    expect(chips()).toHaveLength(0);
    act(() =>
      state.setFiles?.(() => [upload("t1", "teams-chats-2.md"), upload("a1")]),
    );
    expect(chips()).toHaveLength(1);
  });

  it("forgets the record on (x) and reopens the picker on Edit selection", () => {
    const attached = record("t1", ["a1"]);
    renderInput([attached], [upload("t1"), upload("a1")]);
    const chip = chips()[0];

    fireEvent.click(
      within(chip).getByRole("button", { name: "Remove Teams transcript" }),
    );
    expect(picker.forget).toHaveBeenCalledWith("t1");

    fireEvent.click(
      within(chip).getByRole("button", { name: "Edit selection" }),
    );
    expect(picker.open).toHaveBeenCalledWith(state.composer?.bridge, {
      edit: attached,
    });
  });

  it("offers no Edit selection where the picker can't run", () => {
    state.canPick = false;
    renderInput([record("t1", [])], [upload("t1")]);
    expect(
      within(chips()[0]).queryByRole("button", { name: "Edit selection" }),
    ).toBeNull();
  });

  it("unstages one file on its remove and previews the upload it is handed", () => {
    renderInput(
      [record("t1", ["a1", "a2"])],
      [upload("t1"), upload("a1"), upload("a2")],
    );
    act(() => state.options?.onRemoveFile("a1"));
    expect(state.controls.removeUploadedFiles).toHaveBeenCalledWith(["a1"]);
    // Remembered on the record, so an Update does not bring it back.
    expect(picker.excludeAsset).toHaveBeenCalledWith("t1", "a1.pdf");

    const named = { ...upload("a2"), displayName: "roadmap-q1.pdf" };
    state.options?.onFilePreview?.(named);
    expect(onFilePreview).toHaveBeenCalledWith(named);
  });

  it("keeps the chip mounted through an Update that swaps its files", () => {
    renderInput(
      [record("t1", ["a1"])],
      [upload("u"), upload("t1"), upload("a1")],
    );
    const before = chips()[0];
    state.renders = [];

    // What the picker does on Update, in one batch: the composer's files and
    // the record swap together.
    act(() => {
      state.composer?.bridge.replace(record("t1", ["a1"]), [
        upload("t2", "teams-chats-1.md"),
        upload("a3"),
      ]);
      setRecords([record("t2", ["a3"])]);
    });

    expect(state.renders.length).toBeGreaterThan(0);
    for (const ids of state.renders) {
      expect(ids).toEqual(["teams.transcript:lineage-1"]);
    }
    expect(chips()[0]).toBe(before);
    expect(state.controls.removeUploadedFiles).toHaveBeenCalledWith([
      "t1",
      "a1",
    ]);
  });

  it("hands the Teams + row the composer and the transcript nearest the textarea", () => {
    const first = record("t1", [], "lineage-1");
    const second = record("t2", [], "lineage-2");
    renderInput([first, second], [upload("t1"), upload("u"), upload("t2")]);

    expect(chips()).toHaveLength(2);
    expect(state.composer?.stagedTranscript).toBe(second);
    expect(state.composer?.bridge).toBeDefined();
  });

  it("speaks what the picker did through its own region, a repeat too", () => {
    renderInput([], []);
    const region = screen.getByTestId("teams-composer-announcer");
    act(() => state.composer?.bridge.announce("Teams transcript updated."));
    expect(region).toHaveTextContent("Teams transcript updated.");
    const first = region.textContent;
    act(() => state.composer?.bridge.announce("Teams transcript updated."));
    expect(region.textContent).not.toBe(first);
    expect(region).toHaveTextContent("Teams transcript updated.");
  });

  it("tells the chip which of its files the composer did not take", () => {
    renderInput(
      [
        record("t1", ["a1", "a2"], "lineage-1", {
          assetNames: ["a1.pdf", "a2.pdf", "past-the-limit.pdf"],
          excludedAssetNames: ["a2.pdf"],
        }),
      ],
      [upload("t1"), upload("a1")],
    );
    expect(state.entries).toHaveLength(1);
    // a2 was removed by the user, so only the one the limit cut is missing.
    expect(state.entries[0].notAttachedAssetNames).toEqual([
      "past-the-limit.pdf",
    ]);
  });
});
