import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModalBase } from "@/components/ui/Modal/ModalBase";
import { componentRegistry } from "@/config/componentRegistry";

import { ComposerContextLane } from "../ComposerContextLane";
import { readLaneGeometry } from "../composerContextLayout";

import type { LaneGeometry } from "../composerContextLayout";
import type {
  ComposerContextChipFaceProps,
  ComposerContextDetailRenderContext,
  ComposerContextItem,
  ComposerContextState,
} from "../types";

vi.mock("../composerContextLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../composerContextLayout")>()),
  readLaneGeometry: vi.fn(() => null),
}));

const ambient = (
  over: Partial<Extract<ComposerContextItem, { origin: "ambient" }>> = {},
): ComposerContextItem => ({
  id: "doc",
  kind: "word.document",
  origin: "ambient",
  dismissScope: "chat",
  state: "included",
  label: "Supply agreement",
  meta: "Whole document",
  icon: "document",
  ...over,
});

const user = (
  over: Partial<Extract<ComposerContextItem, { origin: "user" }>> = {},
): ComposerContextItem => ({
  id: "drop",
  kind: "outlook.drop",
  origin: "user",
  state: "included",
  label: "Re: Offsite agenda",
  icon: "mail",
  ...over,
});

const live = () =>
  document.querySelector('[data-ui="composer-context-live"]')?.textContent ??
  "";

const chip = (label: string) =>
  screen
    .getByText(label, { selector: '[data-ui="composer-context-chip-label"]' })
    .closest<HTMLElement>('[data-ui="composer-context-chip"]')!;

const openButton = (label: string) =>
  within(chip(label)).getByRole("button", {
    name: (name) => name.startsWith(label),
  });

/**
 * Mirrors a host resolver: an ambient (x) turns the item suggested, a user
 * (x) drops it, + includes it again. The lane only ever sees the result.
 */
function Resolver({
  initial,
  onFocusComposer,
  budget,
  defer = false,
}: {
  initial: ComposerContextItem[];
  onFocusComposer?: () => void;
  budget?: number;
  defer?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [queued, setQueued] = useState<(() => void) | null>(null);
  const apply = (
    update: (current: ComposerContextItem[]) => ComposerContextItem[],
  ) => {
    if (defer) {
      setQueued(() => () => setItems(update));
    } else {
      setItems(update);
    }
  };
  const resolved = useMemo(
    () =>
      items.map(
        (item): ComposerContextItem => ({
          ...item,
          onRemove: () =>
            apply((current) =>
              item.origin === "ambient"
                ? current.map((entry) =>
                    entry.id === item.id
                      ? {
                          ...entry,
                          state: "suggested" as const,
                          meta: undefined,
                        }
                      : entry,
                  )
                : current.filter((entry) => entry.id !== item.id),
            ),
          onRestore: () =>
            apply((current) =>
              current.map((entry) =>
                entry.id === item.id
                  ? { ...entry, state: "included" as const }
                  : entry,
              ),
            ),
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, defer],
  );
  return (
    <>
      <ComposerContextLane
        items={resolved}
        budget={budget}
        onFocusComposer={onFocusComposer}
      />
      <button type="button" onClick={() => queued?.()}>
        resolve
      </button>
      <button
        type="button"
        onClick={() =>
          setItems((current) =>
            current.map((entry) =>
              entry.id === "sel"
                ? { ...entry, label: `${entry.label}!` }
                : entry,
            ),
          )
        }
      >
        change selection
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(readLaneGeometry).mockReturnValue(null);
});

describe("ComposerContextLane", () => {
  it("is a named list of chips, ambient first, never reordered by state", () => {
    const { rerender } = render(
      <ComposerContextLane
        items={[
          user({ id: "u1", label: "Notes.txt" }),
          ambient({ id: "sel", kind: "word.selection", label: "Passage" }),
          ambient(),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Message context" });
    expect(list).toHaveAttribute("data-ui", "composer-context-lane");
    const labels = () =>
      within(list)
        .getAllByRole("listitem")
        .map(
          (item) =>
            item.querySelector('[data-ui="composer-context-chip-label"]')
              ?.textContent,
        );
    expect(labels()).toEqual(["Passage", "Supply agreement", "Notes.txt"]);

    rerender(
      <ComposerContextLane
        items={[
          user({ id: "u1", label: "Notes.txt" }),
          ambient({
            id: "sel",
            kind: "word.selection",
            label: "Passage",
            state: "suggested",
            onRestore: vi.fn(),
          }),
          ambient(),
        ]}
      />,
    );
    expect(labels()).toEqual(["Passage", "Supply agreement", "Notes.txt"]);
    expect(chip("Passage")).toHaveAttribute("data-state", "suggested");
    expect(chip("Passage")).toHaveAttribute("data-kind", "word.selection");
    expect(chip("Passage")).toHaveAttribute("data-origin", "ambient");
    expect(chip("Notes.txt")).toHaveAttribute("data-origin", "user");
  });

  it("takes the host's own name for the list", () => {
    render(
      <ComposerContextLane
        items={[ambient()]}
        label="Attachments of this message"
      />,
    );
    expect(
      screen.getByRole("list", { name: "Attachments of this message" }),
    ).toHaveAttribute("data-ui", "composer-context-lane");
  });

  it("keeps an item where its placement says when its origin changes", () => {
    const labelsOf = () =>
      within(screen.getByRole("list", { name: "Message context" }))
        .getAllByRole("listitem")
        .map(
          (item) =>
            item.querySelector('[data-ui="composer-context-chip-label"]')
              ?.textContent,
        );
    const items = (origin: "ambient" | "user") => [
      ambient({ id: "doc", label: "Supply agreement" }),
      origin === "user"
        ? user({ id: "c", label: "Comment", placement: "ambient" })
        : ambient({ id: "c", label: "Comment", placement: "ambient" }),
      ambient({ id: "open", label: "Open comments" }),
      user({ id: "u1", label: "Notes.txt" }),
    ];
    const { rerender } = render(
      <ComposerContextLane items={items("ambient")} />,
    );
    const order = ["Supply agreement", "Comment", "Open comments", "Notes.txt"];
    expect(labelsOf()).toEqual(order);
    rerender(<ComposerContextLane items={items("user")} />);
    expect(labelsOf()).toEqual(order);
    expect(chip("Comment")).toHaveAttribute("data-origin", "user");
  });

  it("renders nothing without items", () => {
    const { container } = render(<ComposerContextLane items={[]} />);
    expect(container.querySelector('[role="list"]')).toBeNull();
    // Standalone, it still owns its live region.
    expect(
      container.querySelector('[data-ui="composer-context-live"]'),
    ).not.toBeNull();
  });

  describe("controls", () => {
    it.each([
      ["included", "composer-context-remove"],
      ["superseded", "composer-context-remove"],
      ["loading", "composer-context-remove"],
      ["error", "composer-context-remove"],
      ["attention", "composer-context-remove"],
      ["suggested", "composer-context-restore"],
    ] as const)("a %s chip offers %s", (state, hook) => {
      render(
        <ComposerContextLane
          items={[ambient({ state, onRemove: vi.fn(), onRestore: vi.fn() })]}
        />,
      );
      const item = chip("Supply agreement");
      expect(item).toHaveAttribute("data-state", state);
      expect(
        item.querySelectorAll("[data-ui^='composer-context-re']"),
      ).toHaveLength(1);
      const control = item.querySelector(`[data-ui="${hook}"]`)!;
      expect(control).not.toBeNull();
      // A sibling of the open button, never inside it.
      expect(control.parentElement).toBe(item);
      expect(openButton("Supply agreement").contains(control)).toBe(false);
      expect(control).toHaveAttribute("tabindex", "-1");
    });

    it("draws no control without the matching handler", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { rerender } = render(
        <ComposerContextLane
          items={[ambient({ state: "loading" }), user({ state: "suggested" })]}
        />,
      );
      expect(
        document.querySelector("[data-ui='composer-context-remove']"),
      ).toBeNull();
      expect(
        document.querySelector("[data-ui='composer-context-restore']"),
      ).toBeNull();
      rerender(
        <ComposerContextLane
          items={[ambient({ state: "loading" }), user({ state: "suggested" })]}
        />,
      );
      // One dev warning per suggested item that cannot be included again.
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("names controls by default and by the host's words", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({ onRemove: vi.fn() }),
            ambient({
              id: "draft",
              label: "Draft",
              state: "suggested",
              onRestore: vi.fn(),
            }),
            ambient({
              id: "sel",
              label: "Passage",
              onRemove: vi.fn(),
              removeLabel: "Dismiss selection",
            }),
            ambient({
              id: "draft2",
              label: "Second draft",
              state: "suggested",
              onRestore: vi.fn(),
              restoreLabel: "Include draft",
            }),
          ]}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Remove Supply agreement" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Include Draft" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Dismiss selection" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Include draft" }),
      ).toBeInTheDocument();
    });

    it("disables a locked control but keeps the detail openable", () => {
      render(
        <ComposerContextLane
          items={[
            user({
              locked: true,
              lockReason: "Wait until the drop finishes",
              onRemove: vi.fn(),
              detail: { title: "Dropped email", render: () => "body" },
            }),
          ]}
        />,
      );
      const remove = screen.getByRole("button", {
        name: "Remove Re: Offsite agenda",
      });
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute("title", "Wait until the drop finishes");
      const open = openButton("Re: Offsite agenda");
      expect(open).not.toBeDisabled();
      expect(open).toHaveAccessibleName(/Included\. Locked\.$/);
      fireEvent.click(open);
      expect(
        screen.getByRole("dialog", { name: "Dropped email" }),
      ).toBeInTheDocument();
    });
  });

  describe("face", () => {
    it("ends the open button's name with the state word", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({ id: "a", label: "A", state: "included" }),
            ambient({
              id: "b",
              label: "B",
              state: "suggested",
              onRestore: vi.fn(),
            }),
            ambient({ id: "c", label: "C", state: "superseded" }),
            ambient({ id: "d", label: "D", state: "loading" }),
            ambient({ id: "e", label: "E", state: "error" }),
            ambient({ id: "f", label: "F", state: "attention" }),
          ]}
        />,
      );
      expect(openButton("A")).toHaveAccessibleName(/Included\.$/);
      expect(openButton("B")).toHaveAccessibleName(/Not included\.$/);
      expect(openButton("C")).toHaveAccessibleName(/Not sent\.$/);
      expect(openButton("D")).toHaveAccessibleName(/Loading\.$/);
      expect(openButton("E")).toHaveAccessibleName(/Error\.$/);
      expect(openButton("F")).toHaveAccessibleName(/Needs your choice\.$/);
      expect(chip("E")).toHaveAttribute("data-tone", "error");
      expect(chip("F")).toHaveAttribute("data-tone", "warning");
      expect(chip("A")).toHaveAttribute("data-tone", "neutral");
    });

    it("keeps a short label at its own width instead of padding it to the floor", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({ id: "short", label: "a.docx", meta: "86 ¶" }),
            ambient({ id: "long", label: "Supply agreement.docx" }),
          ]}
        />,
      );
      const label = (text: string) =>
        screen.getByText(text, {
          selector: '[data-ui="composer-context-chip-label"]',
        });
      expect(label("a.docx")).toHaveClass("shrink-0");
      // shrink-[2] comes later in the stylesheet and would win over shrink-0.
      expect(label("a.docx")).not.toHaveClass("shrink-[2]");
      expect(label("a.docx")).not.toHaveClass("min-w-[7em]");
      expect(label("Supply agreement.docx")).toHaveClass("min-w-[7em]");
      expect(label("Supply agreement.docx")).toHaveClass("shrink-[2]");
    });

    it("counts wide characters twice, so a short CJK name still truncates", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({
              id: "cjk",
              label: "供应协议最终版本文件",
              meta: "Track Changes on · First 453 of 1,590 ¶",
            }),
            ambient({ id: "kana", label: "メモ.docx", meta: "86 ¶" }),
          ]}
        />,
      );
      const label = (text: string) =>
        screen.getByText(text, {
          selector: '[data-ui="composer-context-chip-label"]',
        });
      expect(label("供应协议最终版本文件")).toHaveClass("min-w-[7em]");
      expect(label("供应协议最终版本文件")).not.toHaveClass("shrink-0");
      expect(label("メモ.docx")).toHaveClass("shrink-0");
      expect(label("メモ.docx")).not.toHaveClass("shrink-[2]");
    });

    it("hides every glyph and draws no text glyphs", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({ onRemove: vi.fn(), locked: true }),
            ambient({ id: "l", label: "Reading", state: "loading" }),
          ]}
        />,
      );
      const lane = screen.getByRole("list");
      for (const svg of lane.querySelectorAll("svg")) {
        expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
      }
      // The loading spinner adds no second status region.
      expect(lane.querySelector('[role="status"]')).toBeNull();
      expect(lane.textContent).not.toMatch(
        /[✂✕✖×]|\p{Extended_Pictographic}/u,
      );
    });

    it("states the lifetime of a suggested ambient chip without meta", () => {
      render(
        <ComposerContextLane
          items={[
            ambient({
              state: "suggested",
              meta: undefined,
              dismissScope: "message",
              onRestore: vi.fn(),
            }),
            ambient({
              id: "sel",
              label: "Passage",
              state: "suggested",
              meta: undefined,
              dismissScope: "selection",
              onRestore: vi.fn(),
            }),
          ]}
        />,
      );
      expect(chip("Supply agreement")).toHaveTextContent(
        "Off for this message",
      );
      expect(chip("Passage")).toHaveTextContent(
        "Off until the selection changes",
      );
    });

    it("draws a kit face inside the open button, keeping the host control", () => {
      const KitFace = ({ item, meta }: ComposerContextChipFaceProps) => (
        <span data-testid="kit-face">{`${item.label} (${meta ?? ""})`}</span>
      );
      const previous = componentRegistry.ComposerContextChipFace;
      componentRegistry.ComposerContextChipFace = KitFace;
      try {
        render(
          <ComposerContextLane
            items={[
              ambient({
                onRemove: vi.fn(),
                detail: { title: "Doc", render: () => null },
              }),
            ]}
          />,
        );
        const face = screen.getByTestId("kit-face");
        const open = face.closest('[data-ui="composer-context-chip-open"]')!;
        expect(open).toHaveAttribute("aria-haspopup", "dialog");
        const control = screen.getByRole("button", {
          name: "Remove Supply agreement",
        });
        expect(open.contains(control)).toBe(false);
      } finally {
        componentRegistry.ComposerContextChipFace = previous;
      }
    });

    it("keeps the item's icon for a tone alone, and marks an error or a choice", () => {
      const glyph = (label: string) =>
        chip(label).querySelector('[data-ui="composer-context-chip-icon"]')!
          .innerHTML;
      render(
        <ComposerContextLane
          items={[
            ambient({ id: "a", label: "Plain" }),
            ambient({ id: "b", label: "Tracked", tone: "warning" }),
            ambient({ id: "c", label: "Choose", state: "attention" }),
            ambient({ id: "d", label: "Broken", state: "error" }),
          ]}
        />,
      );
      expect(glyph("Tracked")).toBe(glyph("Plain"));
      expect(glyph("Choose")).not.toBe(glyph("Plain"));
      expect(glyph("Broken")).not.toBe(glyph("Plain"));
      expect(glyph("Broken")).not.toBe(glyph("Choose"));
    });

    it("draws the tone's mark when the item asks for it", () => {
      const glyph = (label: string) =>
        chip(label).querySelector('[data-ui="composer-context-chip-icon"]')!
          .innerHTML;
      render(
        <ComposerContextLane
          items={[
            ambient({ id: "a", label: "Plain" }),
            ambient({ id: "b", label: "Choose", state: "attention" }),
            ambient({
              id: "c",
              label: "Cut",
              tone: "warning",
              toneIcon: "tone",
            }),
            ambient({ id: "d", label: "Neutral", toneIcon: "tone" }),
          ]}
        />,
      );
      expect(glyph("Cut")).toBe(glyph("Choose"));
      expect(glyph("Neutral")).toBe(glyph("Plain"));
    });

    it("prefers the chipFace prop over the registry", () => {
      const previous = componentRegistry.ComposerContextChipFace;
      componentRegistry.ComposerContextChipFace = function RegistryFace() {
        return <span>registry</span>;
      };
      try {
        render(
          <ComposerContextLane
            items={[ambient()]}
            chipFace={function PropFace() {
              return <span>prop face</span>;
            }}
          />,
        );
        expect(screen.getByText("prop face")).toBeInTheDocument();
        expect(screen.queryByText("registry")).toBeNull();
      } finally {
        componentRegistry.ComposerContextChipFace = previous;
      }
    });
  });

  describe("state comes from the host", () => {
    it("renders the state it is given, not the click", () => {
      const onRemove = vi.fn();
      const { rerender } = render(
        <ComposerContextLane items={[ambient({ onRemove })]} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Supply agreement" }),
      );
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "included",
      );
      expect(live()).toBe("");

      rerender(
        <ComposerContextLane
          items={[ambient({ state: "suggested", onRestore: vi.fn() })]}
        />,
      );
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(live()).toBe("Supply agreement removed. Include again with +");
    });

    it("announces nothing when the host keeps the state", () => {
      const onRemove = vi.fn();
      const { rerender } = render(
        <ComposerContextLane items={[ambient({ onRemove })]} />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Supply agreement" }),
      );
      rerender(<ComposerContextLane items={[ambient({ onRemove })]} />);
      expect(live()).toBe("");
    });
  });

  describe("keyboard", () => {
    const three = [
      ambient({ id: "sel", kind: "word.selection", label: "Passage" }),
      ambient(),
      user(),
    ];

    it("is one tab stop that arrows walk without wrapping", () => {
      render(<Resolver initial={three} />);
      const lane = screen.getByRole("list");
      const stops = () =>
        [
          ...lane.querySelectorAll('[data-ui="composer-context-chip-open"]'),
        ].filter((button) => button.getAttribute("tabindex") === "0");
      expect(stops()).toHaveLength(1);
      expect(stops()[0]).toBe(openButton("Passage"));

      openButton("Passage").focus();
      fireEvent.keyDown(openButton("Passage"), { key: "ArrowLeft" });
      expect(openButton("Passage")).toHaveFocus();
      fireEvent.keyDown(openButton("Passage"), { key: "ArrowRight" });
      expect(openButton("Supply agreement")).toHaveFocus();
      fireEvent.keyDown(openButton("Supply agreement"), { key: "ArrowDown" });
      expect(openButton("Re: Offsite agenda")).toHaveFocus();
      fireEvent.keyDown(openButton("Re: Offsite agenda"), {
        key: "ArrowRight",
      });
      expect(openButton("Re: Offsite agenda")).toHaveFocus();
      fireEvent.keyDown(openButton("Re: Offsite agenda"), { key: "Home" });
      expect(openButton("Passage")).toHaveFocus();
      fireEvent.keyDown(openButton("Passage"), { key: "End" });
      expect(openButton("Re: Offsite agenda")).toHaveFocus();
      fireEvent.keyDown(openButton("Re: Offsite agenda"), { key: "ArrowUp" });
      expect(openButton("Supply agreement")).toHaveFocus();
      expect(stops()).toEqual([openButton("Supply agreement")]);
    });

    it("keeps one tab stop when the active chip leaves", () => {
      const { rerender } = render(<ComposerContextLane items={three} />);
      openButton("Supply agreement").focus();
      rerender(<ComposerContextLane items={[three[0], three[2]]} />);
      const stops = [
        ...document.querySelectorAll('[data-ui="composer-context-chip-open"]'),
      ].filter((button) => button.getAttribute("tabindex") === "0");
      expect(stops).toEqual([openButton("Re: Offsite agenda")]);
    });

    it("Delete on an ambient chip turns it suggested and keeps focus there", () => {
      render(<Resolver initial={three} />);
      openButton("Supply agreement").focus();
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(openButton("Supply agreement")).toHaveFocus();
      expect(live()).toBe("Supply agreement removed. Include again with +");

      fireEvent.keyDown(openButton("Supply agreement"), { key: "+" });
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "included",
      );
      expect(live()).toBe("Supply agreement included.");
      expect(openButton("Supply agreement")).toHaveFocus();
    });

    it("Delete on a suggested chip explains + instead of removing", () => {
      const onRestore = vi.fn();
      render(
        <ComposerContextLane
          items={[ambient({ state: "suggested", onRestore })]}
        />,
      );
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Backspace" });
      expect(onRestore).not.toHaveBeenCalled();
      expect(live()).toBe(
        "Supply agreement is not included. Press + to include it.",
      );
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Insert" });
      expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it("Delete on a locked chip says why and calls nothing", () => {
      const onRemove = vi.fn();
      render(
        <ComposerContextLane
          items={[
            user({ onRemove, locked: true, lockReason: "Still preparing" }),
            ambient({ id: "x", label: "Transcript", locked: true, onRemove }),
            ambient({ id: "y", label: "Dropping", state: "loading" }),
          ]}
        />,
      );
      fireEvent.keyDown(openButton("Re: Offsite agenda"), { key: "Delete" });
      expect(live()).toBe("Still preparing");
      fireEvent.keyDown(openButton("Transcript"), { key: "Delete" });
      expect(live()).toBe("Transcript is locked.");
      fireEvent.keyDown(openButton("Dropping"), { key: "Delete" });
      expect(live()).toBe("Dropping can't be removed.");
      expect(onRemove).not.toHaveBeenCalled();
    });

    it("moves focus to the next chip when a user chip leaves, then to the composer", () => {
      const onFocusComposer = vi.fn();
      render(
        <Resolver
          initial={[
            ambient(),
            user({ id: "u1", label: "First.pdf" }),
            user({ id: "u2", label: "Second.pdf" }),
          ]}
          onFocusComposer={onFocusComposer}
        />,
      );
      openButton("First.pdf").focus();
      fireEvent.keyDown(openButton("First.pdf"), { key: "Delete" });
      expect(screen.queryByText("First.pdf")).toBeNull();
      expect(openButton("Second.pdf")).toHaveFocus();
      expect(live()).toBe("First.pdf removed.");

      fireEvent.keyDown(openButton("Second.pdf"), { key: "Delete" });
      // No chip after it: the one before.
      expect(openButton("Supply agreement")).toHaveFocus();
      expect(onFocusComposer).not.toHaveBeenCalled();
    });

    it("hands focus to the composer when the last chip leaves", () => {
      const onFocusComposer = vi.fn();
      render(<Resolver initial={[user()]} onFocusComposer={onFocusComposer} />);
      openButton("Re: Offsite agenda").focus();
      fireEvent.keyDown(openButton("Re: Offsite agenda"), { key: "Delete" });
      expect(screen.queryByRole("list")).toBeNull();
      expect(onFocusComposer).toHaveBeenCalledTimes(1);
      // The lane's own region outlives the list.
      expect(live()).toBe("Re: Offsite agenda removed.");
    });

    it("ignores keys while an IME is composing", () => {
      const onRemove = vi.fn();
      render(<ComposerContextLane items={[ambient({ onRemove })]} />);
      fireEvent.keyDown(openButton("Supply agreement"), {
        key: "Delete",
        isComposing: true,
      });
      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  describe("announcements", () => {
    it("uses the host's words when it gives them", () => {
      render(
        <Resolver
          initial={[
            ambient({
              announcements: {
                removed: "Draft left out. Include again with +",
                restored: "Draft included again.",
              },
            }),
          ]}
        />,
      );
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
      expect(live()).toBe("Draft left out. Include again with +");
      fireEvent.keyDown(openButton("Supply agreement"), { key: "+" });
      expect(live()).toBe("Draft included again.");
    });

    it("waits for the outcome through unrelated churn", () => {
      render(
        <Resolver
          defer
          initial={[
            ambient({ id: "sel", kind: "word.selection", label: "Passage" }),
            ambient(),
          ]}
        />,
      );
      openButton("Supply agreement").focus();
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
      expect(live()).toBe("");
      // The selection moves before the host answers; that is not the outcome.
      fireEvent.click(screen.getByRole("button", { name: "change selection" }));
      expect(live()).toBe("");
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "included",
      );
      fireEvent.click(screen.getByRole("button", { name: "resolve" }));
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(live()).toBe("Supply agreement removed. Include again with +");
      expect(openButton("Supply agreement")).toHaveFocus();
    });

    it("does not announce ambient churn or move focus", () => {
      render(
        <>
          <textarea aria-label="composer" />
          <Resolver
            initial={[
              ambient({ id: "sel", kind: "word.selection", label: "Passage" }),
            ]}
          />
        </>,
      );
      const composer = screen.getByRole("textbox", { name: "composer" });
      composer.focus();
      fireEvent.click(screen.getByRole("button", { name: "change selection" }));
      expect(chip("Passage!")).toBeInTheDocument();
      expect(live()).toBe("");
      // The click above moved focus to the test's own button; what matters
      // is that the lane did not take it.
      expect(screen.getByRole("list").contains(document.activeElement)).toBe(
        false,
      );
    });

    it("announces loading turning into an error or a choice", () => {
      const { rerender } = render(
        <ComposerContextLane
          items={[
            ambient({ state: "loading", meta: "Reading document…" }),
            ambient({
              id: "c",
              label: "Comments",
              state: "loading",
              meta: undefined,
            }),
          ]}
        />,
      );
      rerender(
        <ComposerContextLane
          items={[
            ambient({ state: "error", meta: "Couldn't read the document" }),
            ambient({
              id: "c",
              label: "Comments",
              state: "loading",
              meta: undefined,
            }),
          ]}
        />,
      );
      expect(live()).toBe("Supply agreement: Couldn't read the document");
      rerender(
        <ComposerContextLane
          items={[
            ambient({ state: "error", meta: "Couldn't read the document" }),
            ambient({
              id: "c",
              label: "Comments",
              state: "attention",
              meta: undefined,
            }),
          ]}
        />,
      );
      expect(live()).toBe("Comments: Needs a choice");
    });

    it("re-announces a repeated message", () => {
      const onRestore = vi.fn();
      render(
        <ComposerContextLane
          items={[ambient({ state: "suggested", onRestore })]}
        />,
      );
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
      const first = live();
      fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
      expect(live()).not.toBe(first);
      expect(live().trim()).toContain("is not included");
    });

    it("speaks an item by its spoken name", () => {
      const quote = "“The Supplier shall deliver…”";
      render(
        <Resolver
          initial={[
            ambient({
              id: "sel",
              kind: "word.selection",
              label: quote,
              spokenLabel: "Selection",
              meta: "Selected passage",
            }),
          ]}
        />,
      );
      expect(
        within(chip(quote)).getByRole("button", { name: "Remove Selection" }),
      ).toBeInTheDocument();
      fireEvent.keyDown(openButton(quote), { key: "Delete" });
      expect(live()).toBe("Selection removed. Include again with +");
      fireEvent.keyDown(openButton(quote), { key: "Backspace" });
      expect(live()).toBe("Selection is not included. Press + to include it.");
      expect(
        within(chip(quote)).getByRole("button", { name: "Include Selection" }),
      ).toBeInTheDocument();
      fireEvent.keyDown(openButton(quote), { key: "+" });
      expect(live()).toBe("Selection included.");
    });

    it.each([
      ["an error", "error", "Couldn't read", true],
      ["an error, without loading first", "error", "Couldn't read", false],
      ["a choice", "attention", "Choose one", true],
      ["a selection winning", "superseded", "Replaced by selection", false],
    ] as const)(
      "announces a + that ends in %s",
      (_, state, meta, viaLoading) => {
        const onRestore = vi.fn();
        const seed = ambient({
          state: "suggested",
          spokenLabel: "Document",
          meta: undefined,
          onRestore,
        });
        const { rerender } = render(<ComposerContextLane items={[seed]} />);
        fireEvent.keyDown(openButton("Supply agreement"), { key: "+" });
        expect(onRestore).toHaveBeenCalledTimes(1);
        if (viaLoading) {
          rerender(
            <ComposerContextLane
              items={[{ ...seed, state: "loading", meta: "Reading…" }]}
            />,
          );
          expect(live()).toBe("");
        }
        rerender(
          <ComposerContextLane
            items={[{ ...seed, state, meta, onRemove: vi.fn() }]}
          />,
        );
        expect(live()).toBe(`Document: ${meta}`);
      },
    );

    it("does not take a late change for the answer to a click", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      try {
        const onRemove = vi.fn();
        const { rerender } = render(
          <ComposerContextLane items={[ambient({ onRemove })]} />,
        );
        fireEvent.keyDown(openButton("Supply agreement"), { key: "Delete" });
        expect(onRemove).toHaveBeenCalledTimes(1);
        (document.activeElement as HTMLElement).blur();

        now.mockReturnValue(61_000);
        rerender(
          <ComposerContextLane
            items={[
              ambient({
                state: "suggested",
                meta: undefined,
                onRestore: vi.fn(),
              }),
            ]}
          />,
        );
        expect(live()).toBe("");
        expect(document.activeElement).toBe(document.body);
      } finally {
        now.mockRestore();
      }
    });

    it("waits for a + that keeps loading past the timeout", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
      try {
        const seed = ambient({
          state: "suggested",
          meta: undefined,
          onRestore: vi.fn(),
        });
        const other = ambient({
          id: "sel",
          kind: "word.selection",
          label: "Passage",
        });
        const { rerender } = render(
          <ComposerContextLane items={[other, seed]} />,
        );
        fireEvent.keyDown(openButton("Supply agreement"), { key: "+" });
        now.mockReturnValue(1_500);
        rerender(
          <ComposerContextLane
            items={[other, { ...seed, state: "loading" }]}
          />,
        );
        now.mockReturnValue(9_000);
        rerender(
          <ComposerContextLane
            items={[
              { ...other, label: "Passage 2" },
              { ...seed, state: "loading" },
            ]}
          />,
        );
        now.mockReturnValue(12_000);
        rerender(
          <ComposerContextLane
            items={[
              { ...other, label: "Passage 2" },
              { ...seed, state: "included", onRemove: vi.fn() },
            ]}
          />,
        );
        expect(live()).toBe("Supply agreement included.");
      } finally {
        now.mockRestore();
      }
    });

    it("unstages a user item's claimed files only once the host drops it", () => {
      const onRemoveClaimedFiles = vi.fn();
      const transcript = user({
        claimsFileIds: ["f1", "f2"],
        onRemove: vi.fn(),
      });
      const attachments = ambient({
        id: "atts",
        label: "Draft attachments",
        claimsFileIds: ["f3"],
        onRemove: vi.fn(),
      });
      const lane = (items: ComposerContextItem[]) => (
        <ComposerContextLane
          items={items}
          onRemoveClaimedFiles={onRemoveClaimedFiles}
        />
      );
      const { rerender } = render(lane([attachments, transcript]));
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Re: Offsite agenda" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Draft attachments" }),
      );
      rerender(lane([{ ...attachments }, { ...transcript }]));
      expect(onRemoveClaimedFiles).not.toHaveBeenCalled();

      rerender(lane([]));
      expect(onRemoveClaimedFiles.mock.calls).toEqual([[["f1", "f2"]]]);
    });
  });

  describe("detail", () => {
    const withDetail = (
      over: Partial<Extract<ComposerContextItem, { origin: "ambient" }>> = {},
    ) =>
      ambient({
        detail: {
          title: "Document details",
          render: () => <p>Covers the whole document.</p>,
          actions: [
            { id: "instead", label: "Send this instead", onSelect: vi.fn() },
          ],
        },
        ...over,
      });

    it("opens a named popover on Enter and returns focus on Escape", () => {
      render(<Resolver initial={[withDetail()]} />);
      const open = openButton("Supply agreement");
      expect(open).toHaveAttribute("aria-haspopup", "dialog");
      open.focus();
      fireEvent.click(open);
      const dialog = screen.getByRole("dialog", { name: "Document details" });
      expect(dialog).toHaveAttribute("data-ui", "composer-context-detail");
      expect(dialog).toHaveAttribute("data-placement", "popover");
      expect(dialog).toHaveAttribute("aria-modal", "false");
      expect(open).toHaveAttribute("aria-expanded", "true");
      expect(
        within(dialog).getByText("Covers the whole document."),
      ).toBeInTheDocument();
      expect(
        dialog.querySelector('[data-ui="composer-context-detail-state"]'),
      ).toHaveTextContent("Included");
      // Never inside the lane.
      expect(screen.getByRole("list").contains(dialog)).toBe(false);
      expect(
        within(dialog).getByRole("button", { name: "Close details" }),
      ).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(open).toHaveFocus();
    });

    it("tints the state pill only for a state the detail resolves", () => {
      const pill = () =>
        screen
          .getByRole("dialog")
          .querySelector('[data-ui="composer-context-detail-state"]');
      const { unmount } = render(
        <Resolver
          initial={[withDetail({ state: "attention", tone: "warning" })]}
        />,
      );
      fireEvent.click(openButton("Supply agreement"));
      expect(pill()).toHaveTextContent("Needs a choice");
      expect(pill()).toHaveAttribute("data-tone", "warning");
      expect(pill()).toHaveClass(
        "bg-theme-warning-bg",
        "text-theme-warning-fg",
      );
      unmount();

      render(
        <Resolver initial={[withDetail({ state: "error", tone: "error" })]} />,
      );
      fireEvent.click(openButton("Supply agreement"));
      expect(pill()).toHaveAttribute("data-tone", "error");
      expect(pill()).toHaveClass("bg-theme-error-bg", "text-theme-error-fg");
      cleanup();

      render(<Resolver initial={[withDetail({ tone: "warning" })]} />);
      fireEvent.click(openButton("Supply agreement"));
      expect(pill()).toHaveTextContent("Included");
      expect(pill()).not.toHaveAttribute("data-tone");
      expect(pill()).toHaveClass("border-theme-border");
    });

    it("keeps Tab inside the popover", () => {
      render(<Resolver initial={[withDetail()]} />);
      fireEvent.click(openButton("Supply agreement"));
      const dialog = screen.getByRole("dialog");
      const buttons = within(dialog).getAllByRole("button");
      const last = buttons[buttons.length - 1];
      last.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });
      expect(buttons[0]).toHaveFocus();
      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
    });

    it("closes on an outside press and toggles on its own chip", () => {
      render(
        <>
          <button type="button">elsewhere</button>
          <Resolver initial={[withDetail()]} />
        </>,
      );
      const open = openButton("Supply agreement");
      fireEvent.click(open);
      fireEvent.pointerDown(open);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(open);
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(open);
      fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("tells the body whether the item is locked", () => {
      const renderBody = vi.fn(({ locked }: { locked: boolean }) => (
        <p>{locked ? "locked body" : "open body"}</p>
      ));
      const item = user({
        detail: { title: "Teams transcript", render: renderBody },
      });
      const { rerender } = render(<ComposerContextLane items={[item]} />);
      fireEvent.click(openButton("Re: Offsite agenda"));
      expect(renderBody).toHaveBeenLastCalledWith(
        expect.objectContaining({ locked: false }),
      );
      expect(screen.getByText("open body")).toBeInTheDocument();

      rerender(<ComposerContextLane items={[{ ...item, locked: true }]} />);
      expect(renderBody).toHaveBeenLastCalledWith(
        expect.objectContaining({ locked: true }),
      );
      expect(screen.getByText("locked body")).toBeInTheDocument();
    });

    it("locks the host choices of a locked item that claims files", () => {
      const onSelect = vi.fn();
      const detail = {
        title: "Teams transcript",
        render: () => <p>Three conversations.</p>,
        actions: [{ id: "edit", label: "Edit selection", onSelect }],
      };
      const item = user({ claimsFileIds: ["f1"], detail });
      const { rerender } = render(<ComposerContextLane items={[item]} />);
      fireEvent.click(openButton("Re: Offsite agenda"));
      expect(
        screen.getByRole("button", { name: "Edit selection" }),
      ).toBeEnabled();

      rerender(
        <ComposerContextLane
          items={[{ ...item, locked: true, lockReason: "Uploading" }]}
        />,
      );
      const locked = screen.getByRole("button", { name: "Edit selection" });
      expect(locked).toBeDisabled();
      expect(locked).toHaveAttribute("title", "Uploading");
      fireEvent.click(locked);
      expect(onSelect).not.toHaveBeenCalled();

      // The lane's own lock gives no reason; the button still says why.
      rerender(<ComposerContextLane items={[{ ...item, locked: true }]} />);
      expect(
        screen.getByRole("button", { name: "Edit selection" }),
      ).toHaveAttribute("title", "Re: Offsite agenda is locked.");

      // Without files of its own, a locked item keeps choices that read.
      rerender(
        <ComposerContextLane
          items={[{ ...item, claimsFileIds: undefined, locked: true }]}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Edit selection" }),
      ).toBeEnabled();
    });

    it("stays open under a dialog it opened over itself", () => {
      const Preview = () => {
        const [open, setOpen] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Preview notes.pdf
            </button>
            {open ? (
              <ModalBase
                isOpen
                onClose={() => setOpen(false)}
                title="Preview: notes.pdf"
              >
                <button type="button">Page 2</button>
              </ModalBase>
            ) : null}
          </>
        );
      };
      render(
        <>
          <button type="button">elsewhere</button>
          <Resolver
            initial={[
              withDetail({
                detail: {
                  title: "Document details",
                  render: () => <Preview />,
                },
              }),
            ]}
          />
        </>,
      );
      fireEvent.click(openButton("Supply agreement"));
      const preview = screen.getByRole("button", { name: "Preview notes.pdf" });
      preview.focus();
      fireEvent.click(preview);
      const stacked = screen.getByRole("dialog", {
        name: "Preview: notes.pdf",
      });
      fireEvent.pointerDown(
        within(stacked).getByRole("button", { name: "Page 2" }),
      );
      fireEvent.pointerDown(
        document.querySelector<HTMLElement>('[data-ui="modal-overlay"]')!,
      );
      expect(
        screen.getByRole("dialog", { name: "Document details" }),
      ).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(
        screen.queryByRole("dialog", { name: "Preview: notes.pdf" }),
      ).toBeNull();
      expect(
        screen.getByRole("dialog", { name: "Document details" }),
      ).toBeInTheDocument();
      expect(preview).toHaveFocus();

      fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("offers the default action for the chip's state", () => {
      render(
        <Resolver
          initial={[
            withDetail(),
            user({ detail: { title: "Dropped email", render: () => null } }),
          ]}
        />,
      );
      fireEvent.click(openButton("Supply agreement"));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Leave out",
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "suggested",
      );
      expect(openButton("Supply agreement")).toHaveFocus();

      fireEvent.click(openButton("Supply agreement"));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Include",
        }),
      );
      expect(chip("Supply agreement")).toHaveAttribute(
        "data-state",
        "included",
      );

      fireEvent.click(openButton("Re: Offsite agenda"));
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Remove",
        }),
      );
      expect(screen.queryByText("Re: Offsite agenda")).toBeNull();
      expect(openButton("Supply agreement")).toHaveFocus();
    });

    it("names the footer's remove action apart from the (x)", () => {
      render(
        <ComposerContextLane
          items={[
            withDetail({
              removeLabel: "Don't include this document",
              onRemove: vi.fn(),
            }),
            user({
              detail: { title: "Teams transcript", render: () => null },
              removeLabel: "Remove Teams transcript",
              removeActionLabel: "Remove transcript",
              onRemove: vi.fn(),
            }),
          ]}
        />,
      );
      fireEvent.click(openButton("Supply agreement"));
      let dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("button", { name: "Leave out" }),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", {
          name: "Don't include this document",
        }),
      ).toBeNull();
      fireEvent.click(openButton("Supply agreement"));

      fireEvent.click(openButton("Re: Offsite agenda"));
      dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("button", { name: "Remove transcript" }),
      ).toBeInTheDocument();
    });

    it("runs a host action and disables the default while locked", () => {
      const onSelect = vi.fn();
      render(
        <ComposerContextLane
          items={[
            withDetail({
              locked: true,
              onRemove: vi.fn(),
              detail: {
                title: "Document details",
                render: () => null,
                actions: [
                  { id: "instead", label: "Send this instead", onSelect },
                ],
              },
            }),
          ]}
        />,
      );
      fireEvent.click(openButton("Supply agreement"));
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("button", { name: "Leave out" }),
      ).toBeDisabled();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Send this instead" }),
      );
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(openButton("Supply agreement")).toHaveFocus();
    });

    it("closes when its item leaves", () => {
      const { rerender } = render(
        <ComposerContextLane items={[withDetail(), user()]} />,
      );
      fireEvent.click(openButton("Supply agreement"));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      rerender(<ComposerContextLane items={[user()]} />);
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    describe("a host action's announcement", () => {
      /** A document a selection replaces; its detail action lands it in `outcome`. */
      function ActionHost({
        announcement,
        outcome = "included",
        commit = "batched",
      }: {
        announcement?: string;
        outcome?: ComposerContextState;
        commit?: "batched" | "sync" | "deferred";
      }) {
        const [state, setState] = useState<ComposerContextState>("superseded");
        const [selection, setSelection] = useState("Passage");
        const [queued, setQueued] = useState<(() => void) | null>(null);
        const items = useMemo((): ComposerContextItem[] => {
          const land = () => setState(outcome);
          return [
            ambient({
              id: "sel",
              kind: "word.selection",
              label: selection,
              meta: undefined,
              onRemove: () => {},
            }),
            ambient({
              state,
              spokenLabel: "Document",
              meta:
                state === "error" ? "Couldn't read the document" : undefined,
              onRemove: () => {},
              detail: {
                title: "Supply agreement",
                render: () => null,
                actions: [
                  {
                    id: "send-instead",
                    label: "Send this instead",
                    announcement,
                    onSelect: () => {
                      if (commit === "sync") {
                        flushSync(land);
                      } else if (commit === "deferred") {
                        setQueued(() => land);
                      } else {
                        land();
                      }
                    },
                  },
                ],
              },
            }),
          ];
        }, [state, selection, announcement, outcome, commit]);
        return (
          <>
            <ComposerContextLane items={items} />
            <button type="button" onClick={() => queued?.()}>
              resolve
            </button>
            <button
              type="button"
              onClick={() => setSelection((current) => `${current}!`)}
            >
              change selection
            </button>
          </>
        );
      }

      const runSendInstead = () => {
        fireEvent.click(openButton("Supply agreement"));
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: "Send this instead",
          }),
        );
      };

      it("speaks it once the item's state changes", () => {
        render(
          <ActionHost
            commit="deferred"
            announcement="Document included. Your selection is off until it changes."
          />,
        );
        runSendInstead();
        expect(live()).toBe("");
        expect(openButton("Supply agreement")).toHaveFocus();
        fireEvent.click(screen.getByRole("button", { name: "resolve" }));
        expect(chip("Supply agreement")).toHaveAttribute(
          "data-state",
          "included",
        );
        expect(live()).toBe(
          "Document included. Your selection is off until it changes.",
        );
        expect(openButton("Supply agreement")).toHaveFocus();
      });

      it("is not consumed by another item's change", () => {
        render(<ActionHost commit="deferred" announcement="Document read." />);
        runSendInstead();
        fireEvent.click(
          screen.getByRole("button", { name: "change selection" }),
        );
        expect(live()).toBe("");
        fireEvent.click(screen.getByRole("button", { name: "resolve" }));
        expect(live()).toBe("Document read.");
      });

      it("finds the action when the host commits inside it", () => {
        render(<ActionHost commit="sync" announcement="Document read." />);
        runSendInstead();
        expect(chip("Supply agreement")).toHaveAttribute(
          "data-state",
          "included",
        );
        expect(live()).toBe("Document read.");
      });

      it("says where the item landed when it needs the user", () => {
        render(<ActionHost outcome="error" announcement="Document read." />);
        runSendInstead();
        expect(chip("Supply agreement")).toHaveAttribute("data-state", "error");
        expect(live()).toBe("Document: Couldn't read the document");
      });

      it("speaks nothing for an action without one", () => {
        render(<ActionHost />);
        runSendInstead();
        expect(chip("Supply agreement")).toHaveAttribute(
          "data-state",
          "included",
        );
        expect(live()).toBe("");
      });
    });

    describe("a choice the body draws", () => {
      /**
       * A comment at the caret that needs a choice; choosing in the body
       * makes the same id the user's pick, whose (x) hands it back.
       */
      function ChoiceHost({
        commit = "batched",
        endsItem = false,
      }: {
        commit?: "batched" | "deferred";
        endsItem?: boolean;
      }) {
        const [picked, setPicked] = useState<string | null>(null);
        const [gone, setGone] = useState(false);
        const [selection, setSelection] = useState("Passage");
        const [queued, setQueued] = useState<(() => void) | null>(null);
        const items = useMemo((): ComposerContextItem[] => {
          const sel = ambient({
            id: "sel",
            kind: "word.selection",
            label: selection,
            meta: undefined,
            onRemove: () => {},
          });
          if (gone) {
            return [sel];
          }
          const choose = (author: string) => () => {
            const land = () => (endsItem ? setGone(true) : setPicked(author));
            if (commit === "deferred") {
              setQueued(() => land);
            } else {
              land();
            }
          };
          const detail = {
            title: "Your cursor is in 2 comments",
            render: ({ runAction }: ComposerContextDetailRenderContext) => (
              <ul>
                {["Paul Martin", "Lena Fischer"].map((author) => (
                  <li key={author}>
                    <button
                      type="button"
                      onClick={() =>
                        runAction({
                          id: `pick:${author}`,
                          label: author,
                          announcement: `Comment by ${author} chosen.`,
                          onSelect: choose(author),
                        })
                      }
                    >
                      {author}
                    </button>
                  </li>
                ))}
              </ul>
            ),
          };
          const comment: ComposerContextItem = picked
            ? user({
                id: "comment",
                kind: "word.comment",
                label: `Comment by ${picked}`,
                spokenLabel: "Chosen comment",
                meta: "Chosen by you",
                icon: "comment",
                announcements: { removed: "Chosen comment removed." },
                onRemove: () => setPicked(null),
                detail,
              })
            : ambient({
                id: "comment",
                kind: "word.comment",
                state: "attention",
                tone: "warning",
                dismissScope: "message",
                label: "Cursor is in 2 comments",
                spokenLabel: "Comments",
                meta: "Choose one",
                icon: "comments",
                onRemove: () => {},
                detail,
              });
          return [sel, comment];
        }, [picked, gone, selection, commit, endsItem]);
        return (
          <>
            <ComposerContextLane items={items} />
            <button type="button" onClick={() => queued?.()}>
              resolve
            </button>
            <button
              type="button"
              onClick={() => setSelection((current) => `${current}!`)}
            >
              change selection
            </button>
          </>
        );
      }

      const choose = (author: string) => {
        fireEvent.click(openButton("Cursor is in 2 comments"));
        fireEvent.click(
          within(screen.getByRole("dialog")).getByRole("button", {
            name: author,
          }),
        );
      };

      it("runs it as a footer action: closed, announced once the item changes, focus on the chip", () => {
        render(<ChoiceHost commit="deferred" />);
        const node = chip("Cursor is in 2 comments");
        choose("Paul Martin");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(openButton("Cursor is in 2 comments")).toHaveFocus();
        expect(live()).toBe("");

        fireEvent.click(
          screen.getByRole("button", { name: "change selection" }),
        );
        expect(live()).toBe("");

        fireEvent.click(screen.getByRole("button", { name: "resolve" }));
        expect(chip("Comment by Paul Martin")).toBe(node);
        expect(node).toHaveAttribute("data-origin", "user");
        expect(live()).toBe("Comment by Paul Martin chosen.");
        expect(openButton("Comment by Paul Martin")).toHaveFocus();
      });

      it("says a removal when the same id comes back as ambient context, keeping focus", () => {
        render(<ChoiceHost />);
        choose("Lena Fischer");
        const node = chip("Comment by Lena Fischer");
        fireEvent.keyDown(openButton("Comment by Lena Fischer"), {
          key: "Delete",
        });
        expect(chip("Cursor is in 2 comments")).toBe(node);
        expect(node).toHaveAttribute("data-origin", "ambient");
        expect(node).toHaveAttribute("data-state", "attention");
        expect(live()).toBe("Chosen comment removed.");
        expect(openButton("Cursor is in 2 comments")).toHaveFocus();
      });

      it("speaks a choice that ends its item, then moves focus on", () => {
        render(<ChoiceHost endsItem />);
        choose("Paul Martin");
        expect(screen.queryByText("Cursor is in 2 comments")).toBeNull();
        expect(live()).toBe("Comment by Paul Martin chosen.");
        expect(openButton("Passage")).toHaveFocus();
      });
    });

    describe("in a narrow pane", () => {
      const original = window.matchMedia;
      beforeEach(() => {
        window.matchMedia = (query: string) => ({
          ...original(query),
          matches: query === "(max-width: 479.98px)",
        });
      });
      afterEach(() => {
        window.matchMedia = original;
      });

      it("opens as a bottom sheet with focus inside and Escape back to the chip", () => {
        render(<Resolver initial={[withDetail()]} />);
        const open = openButton("Supply agreement");
        open.focus();
        fireEvent.click(open);
        const dialog = screen.getByRole("dialog", { name: "Document details" });
        expect(dialog).toHaveAttribute("data-ui", "modal-shell");
        expect(dialog).toHaveAttribute("data-placement", "bottom");
        expect(
          dialog.querySelector('[data-ui="composer-context-detail"]'),
        ).toHaveAttribute("data-placement", "sheet");
        expect(dialog.querySelector("button")).toHaveFocus();

        const buttons = within(dialog).getAllByRole("button");
        buttons[buttons.length - 1].focus();
        fireEvent.keyDown(dialog, { key: "Tab" });
        expect(buttons[0]).toHaveFocus();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(open).toHaveFocus();
      });

      it("pins the actions below the scrolling body", () => {
        render(<Resolver initial={[withDetail()]} />);
        fireEvent.click(openButton("Supply agreement"));
        const dialog = screen.getByRole("dialog", { name: "Document details" });
        const footer = dialog.querySelector<HTMLElement>(
          '[data-ui="modal-footer"]',
        )!;
        expect(
          within(footer).getByRole("button", { name: "Leave out" }),
        ).toBeInTheDocument();
        expect(
          within(footer).getByRole("button", { name: "Send this instead" }),
        ).toBeInTheDocument();
        expect(
          dialog.querySelector('[data-ui="composer-context-detail"]'),
        ).not.toContainElement(footer);
      });
    });
  });

  describe("overflow", () => {
    const geometry = (count: number): LaneGeometry => ({
      boxes: Array.from({ length: count }, (_, index) => ({
        left: 0,
        top: index * 38,
        width: 292,
        height: 32,
      })),
      moreWidth: 80,
      moreHeight: 32,
      laneWidth: 292,
      rowGap: 6,
      colGap: 6,
    });
    const five = Array.from({ length: 5 }, (_, index) =>
      user({ id: `u${index}`, label: `File ${index}` }),
    );

    it("folds chips past the budget into +N more", () => {
      vi.mocked(readLaneGeometry).mockReturnValue(geometry(5));
      render(<Resolver initial={five} budget={108} />);
      const lane = screen.getByRole("list");
      expect(
        lane.querySelectorAll('[data-ui="composer-context-chip"]'),
      ).toHaveLength(2);
      const more = screen.getByRole("button", { name: "Show 3 more items" });
      expect(more).toHaveTextContent("+3 more");
      expect(more.closest('[data-ui="composer-context-more"]')).toHaveAttribute(
        "data-expanded",
        "false",
      );

      act(() => {
        fireEvent.click(more);
      });
      expect(
        lane.querySelectorAll('[data-ui="composer-context-chip"]'),
      ).toHaveLength(5);
      expect(openButton("File 2")).toHaveFocus();
      expect(live()).toBe("Showing every item.");
      const less = screen.getByRole("button", { name: "Show less" });
      fireEvent.click(less);
      expect(
        lane.querySelectorAll('[data-ui="composer-context-chip"]'),
      ).toHaveLength(2);
      expect(
        screen.getByRole("button", { name: "Show 3 more items" }),
      ).toHaveFocus();
    });

    it("never hides the focused chip on a re-measure", () => {
      vi.mocked(readLaneGeometry).mockReturnValue(geometry(5));
      const { rerender } = render(
        <ComposerContextLane items={five} budget={108} />,
      );
      openButton("File 1").focus();
      // An ambient chip arrives first; the focused chip moves to the third
      // place, past what the budget fits, and stays.
      vi.mocked(readLaneGeometry).mockReturnValue(geometry(6));
      rerender(
        <ComposerContextLane items={[ambient(), ...five]} budget={108} />,
      );
      const shown = [
        ...screen
          .getByRole("list")
          .querySelectorAll('[data-ui="composer-context-chip-label"]'),
      ].map((label) => label.textContent);
      expect(shown).toEqual(["Supply agreement", "File 0", "File 1"]);
      expect(openButton("File 1")).toHaveFocus();
      expect(
        screen.getByRole("button", { name: "Show 3 more items" }),
      ).toBeInTheDocument();
    });

    it("counts with plurals", () => {
      vi.mocked(readLaneGeometry).mockReturnValue(geometry(3));
      render(<Resolver initial={five.slice(0, 3)} budget={70} />);
      expect(
        screen.getByRole("button", { name: "Show 2 more items" }),
      ).toHaveTextContent("+2 more");
    });

    const byChips = (lane: HTMLElement) =>
      geometry(
        lane.querySelectorAll(':scope > [data-ui="composer-context-chip"]')
          .length,
      );

    it("focuses the chip that takes a removed chip's place, folded or not", () => {
      vi.mocked(readLaneGeometry).mockImplementation(byChips);
      render(<Resolver initial={five} budget={108} />);
      expect(
        screen.getByRole("button", { name: "Show 3 more items" }),
      ).toBeInTheDocument();
      openButton("File 1").focus();
      fireEvent.keyDown(openButton("File 1"), { key: "Delete" });
      expect(screen.queryByText("File 1")).toBeNull();
      expect(openButton("File 2")).toHaveFocus();
    });

    it("folds again once every chip fits, or the lane empties", () => {
      vi.mocked(readLaneGeometry).mockImplementation(byChips);
      const { rerender } = render(
        <ComposerContextLane items={five} budget={108} />,
      );
      const expand = () =>
        act(() => {
          fireEvent.click(
            screen.getByRole("button", { name: "Show 3 more items" }),
          );
        });
      expand();
      expect(
        screen.getByRole("button", { name: "Show less" }),
      ).toBeInTheDocument();
      rerender(<ComposerContextLane items={five.slice(0, 1)} budget={108} />);
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();

      rerender(<ComposerContextLane items={five} budget={108} />);
      expand();
      rerender(<ComposerContextLane items={[]} budget={108} />);
      rerender(<ComposerContextLane items={five} budget={108} />);
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Show 3 more items" }),
      ).toBeInTheDocument();
    });

    it("folds again when every item is new", () => {
      vi.mocked(readLaneGeometry).mockImplementation(byChips);
      const { rerender } = render(
        <ComposerContextLane items={five} budget={108} />,
      );
      act(() => {
        fireEvent.click(
          screen.getByRole("button", { name: "Show 3 more items" }),
        );
      });
      const nextMail = five.map((item, index) =>
        user({ id: `v${index}`, label: `Mail ${index}`, kind: item.kind }),
      );
      rerender(<ComposerContextLane items={nextMail} budget={108} />);
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Show 3 more items" }),
      ).toBeInTheDocument();
    });

    it("never folds away a chip that needs the user", () => {
      vi.mocked(readLaneGeometry).mockImplementation(byChips);
      const items = five.map((item, index) =>
        index === 3
          ? { ...item, state: "error" as const, meta: "Couldn't add" }
          : item,
      );
      render(<ComposerContextLane items={items} budget={108} />);
      const shown = [
        ...screen
          .getByRole("list")
          .querySelectorAll('[data-ui="composer-context-chip-label"]'),
      ].map((label) => label.textContent);
      expect(shown).toEqual(["File 0", "File 1", "File 2", "File 3"]);
      expect(
        screen.getByRole("button", { name: "Show 1 more item" }),
      ).toBeInTheDocument();
    });

    it("keeps the tab stop on +N more through a re-measure, and hands it on when nothing folds", () => {
      vi.mocked(readLaneGeometry).mockImplementation(byChips);
      const { rerender } = render(
        <ComposerContextLane items={five} budget={108} />,
      );
      screen.getByRole("button", { name: "Show 3 more items" }).focus();
      rerender(
        <ComposerContextLane
          items={five.map((item, index) =>
            index === 0 ? { ...item, meta: "changed" } : item,
          )}
          budget={108}
        />,
      );
      const more = screen.getByRole("button", { name: "Show 3 more items" });
      expect(more).toHaveFocus();
      expect(more).toHaveAttribute("tabindex", "0");

      rerender(<ComposerContextLane items={five.slice(0, 2)} budget={108} />);
      expect(screen.queryByRole("button", { name: /more item/ })).toBeNull();
      expect(openButton("File 1")).toHaveFocus();
    });
  });
});
