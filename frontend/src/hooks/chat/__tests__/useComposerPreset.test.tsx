import { act, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  readComposerPreset,
  useApplyComposerPreset,
  useOpenNewChatWithPreset,
} from "../useComposerPreset";

import type { ChatInputControlsHandle } from "@/components/ui/Chat/ChatInputControlsContext";

function fakeControls(): ChatInputControlsHandle {
  return {
    setDraftMessage: vi.fn(),
    focusInput: vi.fn(),
    setSelectedFacetIds: vi.fn(),
    setSelectedChatProviderId: vi.fn(),
    toggleFacetId: vi.fn(),
    addUploadedFiles: vi.fn(),
    removeUploadedFiles: vi.fn(),
    clearQueuedMessage: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({ path: location.pathname, state: location.state })}
    </output>
  );
}

function readLocation() {
  return JSON.parse(screen.getByTestId("location").textContent ?? "") as {
    path: string;
    state: unknown;
  };
}

function Composer({ controls }: { controls: ChatInputControlsHandle }) {
  const ref = useRef<ChatInputControlsHandle | null>(controls);
  const [, setTick] = useState(0);
  useApplyComposerPreset(ref);
  return (
    <button type="button" onClick={() => setTick((tick) => tick + 1)}>
      rerender
    </button>
  );
}

describe("useApplyComposerPreset", () => {
  it("applies the preset once and drops it from the history entry", () => {
    const controls = fakeControls();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/chat/new",
            state: {
              composerPreset: { facetIds: ["schedule"], draft: "Remind me" },
              other: 1,
            },
          },
        ]}
      >
        <Composer controls={controls} />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(controls.setSelectedFacetIds).toHaveBeenCalledTimes(1);
    expect(controls.setSelectedFacetIds).toHaveBeenCalledWith(["schedule"]);
    expect(controls.setDraftMessage).toHaveBeenCalledWith("Remind me", {
      focus: false,
      onlyIfEmpty: true,
    });
    expect(controls.focusInput).toHaveBeenCalled();
    expect(readLocation()).toEqual({ path: "/chat/new", state: { other: 1 } });

    act(() => screen.getByRole("button", { name: "rerender" }).click());
    expect(controls.setSelectedFacetIds).toHaveBeenCalledTimes(1);
  });

  it("leaves the composer alone without a preset", () => {
    const controls = fakeControls();
    render(
      <MemoryRouter initialEntries={["/chat/new"]}>
        <Composer controls={controls} />
      </MemoryRouter>,
    );

    expect(controls.setSelectedFacetIds).not.toHaveBeenCalled();
    expect(controls.setDraftMessage).not.toHaveBeenCalled();
  });
});

describe("useOpenNewChatWithPreset", () => {
  function Opener() {
    const open = useOpenNewChatWithPreset();
    return (
      <button type="button" onClick={() => open({ facetIds: ["schedule"] })}>
        open
      </button>
    );
  }

  it("opens a new chat carrying the preset", () => {
    render(
      <MemoryRouter initialEntries={["/scheduled"]}>
        <Opener />
        <LocationProbe />
      </MemoryRouter>,
    );

    act(() => screen.getByRole("button", { name: "open" }).click());

    const location = readLocation();
    expect(location.path).toBe("/chat/new");
    expect(readComposerPreset(location.state)).toEqual({
      facetIds: ["schedule"],
    });
  });
});

describe("readComposerPreset", () => {
  it("ignores state that is not a preset", () => {
    expect(readComposerPreset(null)).toBeNull();
    expect(
      readComposerPreset({ composerPreset: { facetIds: "x" } }),
    ).toBeNull();
    expect(
      readComposerPreset({ composerPreset: { facetIds: [1] } }),
    ).toBeNull();
    expect(
      readComposerPreset({ composerPreset: { facetIds: [], draft: "" } }),
    ).toEqual({ facetIds: [] });
  });
});
