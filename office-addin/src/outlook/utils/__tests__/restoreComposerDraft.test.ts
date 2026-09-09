import { describe, it, expect, vi } from "vitest";

import { restoreComposerDraft } from "../restoreComposerDraft";

import type { FileUploadItem } from "@erato/frontend/library";

function makeControls() {
  return {
    setDraftMessage: vi.fn(),
    addUploadedFiles: vi.fn(),
  };
}

function makeItem(id: string): FileUploadItem {
  return { id, filename: `${id}.pdf` } as FileUploadItem;
}

describe("restoreComposerDraft", () => {
  it("puts the typed message back and focuses the composer", () => {
    const controls = makeControls();

    restoreComposerDraft(controls, [], "Summarise this and draft a reply");

    expect(controls.setDraftMessage).toHaveBeenCalledWith(
      "Summarise this and draft a reply",
      { focus: true },
    );
  });

  it("re-attaches only the files the send was carrying", () => {
    const controls = makeControls();
    const uploaded = [makeItem("a"), makeItem("b"), makeItem("c")];

    restoreComposerDraft(controls, uploaded, "hi", ["a", "c"]);

    expect(controls.addUploadedFiles).toHaveBeenCalledWith([
      uploaded[0],
      uploaded[2],
    ]);
  });

  it("does not re-attach when the send carried no files", () => {
    const controls = makeControls();

    restoreComposerDraft(controls, [makeItem("a")], "hi");

    expect(controls.addUploadedFiles).not.toHaveBeenCalled();
  });

  it("tolerates ids the store no longer holds", () => {
    const controls = makeControls();

    restoreComposerDraft(controls, [makeItem("a")], "hi", ["gone"]);

    expect(controls.addUploadedFiles).not.toHaveBeenCalled();
  });

  it("skips the draft write for an empty message", () => {
    const controls = makeControls();

    restoreComposerDraft(controls, [makeItem("a")], "", ["a"]);

    expect(controls.setDraftMessage).not.toHaveBeenCalled();
    expect(controls.addUploadedFiles).toHaveBeenCalledWith([makeItem("a")]);
  });
});
