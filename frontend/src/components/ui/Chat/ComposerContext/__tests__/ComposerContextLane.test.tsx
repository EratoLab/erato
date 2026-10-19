import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";

import { ComposerContextLane } from "../ComposerContextLane";
import { readLaneGeometry } from "../composerContextLayout";

import type { LaneGeometry } from "../composerContextLayout";
import type {
  ComposerContextChipFaceProps,
  ComposerContextItem,
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
  });
});
