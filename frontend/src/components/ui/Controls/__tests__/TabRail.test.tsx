import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TabRail } from "../TabRail";

import type { TabRailOption, TabRailProps } from "../TabRail";

type View = "list" | "grid" | "table";

const defaultOptions: TabRailOption<View>[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
  { value: "table", label: "Table" },
];

type HarnessProps = Partial<Omit<TabRailProps<View>, "value" | "onChange">> & {
  initialValue?: View;
  onChange?: (value: View) => void;
};

/**
 * The strip is controlled, so selection only actually moves when a parent
 * feeds the new value back in. Arrow keys activate automatically, which is
 * only observable through a real state round-trip.
 */
function Harness({
  options = defaultOptions,
  initialValue = "list",
  onChange,
  ...rest
}: HarnessProps) {
  const [value, setValue] = useState<View>(initialValue);

  return (
    <TabRail
      aria-label="View"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      {...rest}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });
const rail = () => screen.getByRole("tablist", { name: "View" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TabRail", () => {
  describe("rail element", () => {
    it("emits the family hook, the variant and the orientation", () => {
      render(<Harness />);

      const list = rail();
      expect(list).toHaveAttribute("data-ui", "tab-rail");
      expect(list).toHaveAttribute("data-variant", "rail");
      expect(list).toHaveAttribute("data-orientation", "horizontal");
      expect(list).toHaveAttribute("aria-orientation", "horizontal");
      expect(list).toHaveClass("tab-rail-geometry", "flex");
      expect(list).not.toHaveClass("tab-rail-track-geometry");
      expect(list).not.toHaveClass("inline-flex");
    });

    it("announces the orientation on every variant and lays out none", () => {
      const { rerender } = render(<Harness orientation="vertical" />);

      expect(rail()).toHaveAttribute("aria-orientation", "vertical");
      expect(rail()).toHaveAttribute("data-orientation", "vertical");
      // The preferences rail announces vertical but is horizontal below `md`;
      // the direction is the caller's, through className.
      expect(rail()).not.toHaveClass("flex-col");

      rerender(<Harness orientation="vertical" variant="segmented" />);

      expect(rail()).toHaveAttribute("aria-orientation", "vertical");
      expect(rail()).toHaveAttribute("data-variant", "segmented");
      expect(rail()).not.toHaveClass("flex-col");
    });

    it("draws the segmented track from the track geometry and its own paint", () => {
      render(<Harness variant="segmented" />);

      expect(rail()).toHaveClass(
        "tab-rail-geometry",
        "tab-rail-track-geometry",
        "inline-flex",
        "border-theme-border",
        "bg-theme-bg-secondary",
      );
      // Border width, inset and corner come from the geometry class now.
      expect(rail()).not.toHaveClass("border", "p-0.5");
    });

    it("lets the caller name the hook and pass rail classes through", () => {
      render(
        <Harness
          data-ui="assistants-view-switcher"
          className="overflow-x-auto md:flex-col"
        />,
      );

      expect(rail()).toHaveAttribute("data-ui", "assistants-view-switcher");
      expect(rail()).toHaveClass(
        "tab-rail-geometry",
        "md:flex-col",
        "overflow-x-auto",
      );
    });
  });

  describe("tab element", () => {
    it("gives every tab an id, the sub-part hook, the item geometry and a string aria-selected", () => {
      render(
        <Harness initialValue="grid" tabClassName="text-left md:w-full" />,
      );

      for (const element of screen.getAllByRole("tab")) {
        expect(element).toHaveAttribute("id");
        expect(element).toHaveAttribute("type", "button");
        expect(element).toHaveAttribute("data-ui", "tab-rail-tab");
        expect(element).toHaveClass(
          "tab-item-geometry",
          "text-left",
          "md:w-full",
        );
        // The control owns no panel, so an `aria-controls` here could only
        // ever dangle.
        expect(element).not.toHaveAttribute("aria-controls");
      }

      // The string form: three test files read the attribute on an
      // unselected tab, and an omitted attribute is not "false".
      expect(tab("Grid")).toHaveAttribute("aria-selected", "true");
      expect(tab("List")).toHaveAttribute("aria-selected", "false");
      expect(tab("Table")).toHaveAttribute("aria-selected", "false");
    });

    it("takes its corner from the geometry class alone", () => {
      const { rerender } = render(<Harness />);

      const check = () => {
        // A rounded utility would sit outside every token; an inline custom
        // property would outrank a theme's rule. The channel test pins that
        // the class spells its zeros as lengths, so the derived corner
        // survives a theme's retune.
        expect(rail()).not.toHaveAttribute("style");
        for (const element of screen.getAllByRole("tab")) {
          expect(element.className).not.toMatch(/(^|\s)rounded(-|\s|$)/);
          expect(element).not.toHaveAttribute("style");
        }
      };

      check();
      rerender(<Harness variant="segmented" />);
      check();
    });

    it("paints the rail tab with the settings-rail recipe", () => {
      render(<Harness initialValue="grid" />);

      expect(tab("Grid")).toHaveClass(
        "theme-transition",
        "flex",
        "shrink-0",
        "cursor-pointer",
        "items-center",
        "gap-2",
        "whitespace-nowrap",
        "text-sm",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-theme-focus",
        "bg-theme-bg-selected",
        "font-medium",
        "text-theme-fg-primary",
      );
      expect(tab("Grid")).not.toHaveClass("shadow-sm");
      expect(tab("List")).toHaveClass(
        "text-theme-fg-secondary",
        "hover:bg-theme-bg-hover",
      );
      expect(tab("List")).not.toHaveClass(
        "bg-theme-bg-selected",
        "font-medium",
      );
    });

    it("paints the segmented tab with the segment recipe", () => {
      render(<Harness variant="segmented" initialValue="grid" />);

      expect(tab("Grid")).toHaveClass(
        "theme-transition",
        "flex",
        "items-center",
        "gap-1.5",
        "font-medium",
        "focus-visible:outline-none",
        "focus-visible:ring-2",
        "focus-visible:ring-theme-focus",
        "bg-theme-bg-selected",
        "text-theme-fg-primary",
        "shadow-sm",
      );
      expect(tab("List")).toHaveClass(
        "font-medium",
        "text-theme-fg-secondary",
        "hover:text-theme-fg-primary",
      );
      expect(tab("List")).not.toHaveClass(
        "bg-theme-bg-selected",
        "hover:bg-theme-bg-hover",
      );
    });

    it("wraps the icon per variant, hidden from assistive tech", () => {
      const options: TabRailOption<View>[] = [
        { value: "list", label: "List", icon: <svg data-testid="icon" /> },
        { value: "grid", label: "Grid" },
      ];
      const { rerender } = render(<Harness options={options} />);

      let wrapper = screen.getByTestId("icon").parentElement!;
      expect(wrapper).toHaveAttribute("aria-hidden", "true");
      expect(wrapper).toHaveClass("shrink-0");
      expect(wrapper).not.toHaveClass("size-4");
      expect(tab("List")).toHaveAccessibleName("List");

      rerender(<Harness options={options} variant="segmented" />);

      wrapper = screen.getByTestId("icon").parentElement!;
      expect(wrapper).toHaveAttribute("aria-hidden", "true");
      expect(wrapper).toHaveClass("size-4", "shrink-0");
    });

    it("renders the attention dot after the label inside the tab", () => {
      render(
        <Harness
          options={[
            { value: "list", label: "List" },
            {
              value: "grid",
              label: "Label",
              attention: {
                label: "Attention",
                toneClassName: "text-theme-warning-fg",
                pulse: true,
              },
            },
          ]}
        />,
      );

      const grid = screen.getByRole("tab", { name: /^Label/ });
      // The accessible name is the DOM order: label first, then the dot's
      // text. AssistantWelcomeScreen pins "Delegated runs Action required".
      expect(grid).toHaveAccessibleName("Label Attention");

      const dot = within(grid).getByTestId("segmented-control-attention");
      expect(dot).toHaveAttribute("data-ui", "segmented-control-attention");
      expect(dot).toHaveClass(
        "flex",
        "shrink-0",
        "items-center",
        "text-theme-warning-fg",
      );
      expect(dot).toBe(grid.lastElementChild);
      expect(dot.firstElementChild).toHaveClass(
        "size-2",
        "rounded-full",
        "bg-current",
        "animate-pulse",
        "motion-reduce:animate-none",
      );
      expect(dot.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(dot.lastElementChild).toHaveClass("sr-only");
      expect(dot.lastElementChild).toHaveTextContent("Attention");

      expect(
        within(tab("List")).queryByTestId("segmented-control-attention"),
      ).not.toBeInTheDocument();
    });

    it("links a tab to its panel only when one is named, and lets a panel repeat", () => {
      render(
        <Harness
          options={[
            { value: "list", label: "List", panelId: "editor" },
            { value: "grid", label: "Grid", panelId: "editor" },
            { value: "table", label: "Table" },
          ]}
        />,
      );

      // The markdown/preview strip points both tabs at one panel; an API
      // that de-duplicated or required unique panels would break it.
      expect(tab("List")).toHaveAttribute("aria-controls", "editor");
      expect(tab("Grid")).toHaveAttribute("aria-controls", "editor");
      expect(tab("Table")).not.toHaveAttribute("aria-controls");
    });

    it("uses a caller-supplied tab id so a panel can label itself with it", () => {
      render(
        <>
          <Harness
            options={[
              { value: "list", label: "List", id: "prefs-tab-list" },
              { value: "grid", label: "Grid" },
            ]}
          />
          <section role="tabpanel" aria-labelledby="prefs-tab-list" />
        </>,
      );

      expect(tab("List")).toHaveAttribute("id", "prefs-tab-list");
      expect(tab("Grid").id).not.toBe("");
      expect(tab("Grid").id).not.toBe("prefs-tab-list");
      expect(
        screen.getByRole("tabpanel", { name: "List" }),
      ).toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("walks a horizontal rail with Left and Right and leaves Up and Down to the browser", () => {
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);

      const list = tab("List");
      list.focus();

      fireEvent.keyDown(list, { key: "ArrowRight" });
      expect(tab("Grid")).toHaveFocus();
      expect(tab("Grid")).toHaveAttribute("aria-selected", "true");
      expect(onChange).toHaveBeenLastCalledWith("grid");

      fireEvent.keyDown(tab("Grid"), { key: "ArrowLeft" });
      expect(tab("List")).toHaveFocus();
      expect(onChange).toHaveBeenLastCalledWith("list");

      // Not prevented, not moved: the browser keeps the key.
      expect(fireEvent.keyDown(tab("List"), { key: "ArrowDown" })).toBe(true);
      expect(fireEvent.keyDown(tab("List"), { key: "ArrowUp" })).toBe(true);
      expect(tab("List")).toHaveFocus();
      expect(onChange).toHaveBeenCalledTimes(2);

      // A handled key is swallowed even when it moves nothing.
      expect(fireEvent.keyDown(tab("List"), { key: "ArrowRight" })).toBe(false);
    });

    it("walks a vertical rail with Up and Down and leaves Left and Right to the browser", () => {
      const onChange = vi.fn();
      render(<Harness orientation="vertical" onChange={onChange} />);

      const list = tab("List");
      list.focus();

      fireEvent.keyDown(list, { key: "ArrowDown" });
      expect(tab("Grid")).toHaveFocus();
      expect(tab("Grid")).toHaveAttribute("aria-selected", "true");

      fireEvent.keyDown(tab("Grid"), { key: "ArrowUp" });
      expect(tab("List")).toHaveFocus();

      expect(fireEvent.keyDown(tab("List"), { key: "ArrowRight" })).toBe(true);
      expect(fireEvent.keyDown(tab("List"), { key: "ArrowLeft" })).toBe(true);
      expect(tab("List")).toHaveFocus();
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("follows both arrow pairs when told to, whatever it announces", () => {
      render(<Harness orientation="vertical" arrowKeys="both" />);

      const list = tab("List");
      list.focus();

      fireEvent.keyDown(list, { key: "ArrowRight" });
      expect(tab("Grid")).toHaveFocus();

      fireEvent.keyDown(tab("Grid"), { key: "ArrowDown" });
      expect(tab("Table")).toHaveFocus();

      fireEvent.keyDown(tab("Table"), { key: "ArrowLeft" });
      expect(tab("Grid")).toHaveFocus();

      fireEvent.keyDown(tab("Grid"), { key: "ArrowUp" });
      expect(tab("List")).toHaveFocus();
      expect(tab("List")).toHaveAttribute("aria-selected", "true");
    });

    it("wraps at both ends", () => {
      render(<Harness />);

      const list = tab("List");
      list.focus();

      fireEvent.keyDown(list, { key: "ArrowLeft" });
      expect(tab("Table")).toHaveFocus();

      fireEvent.keyDown(tab("Table"), { key: "ArrowRight" });
      expect(tab("List")).toHaveFocus();
    });

    it("jumps to the edges with Home and End on every axis", () => {
      const { rerender } = render(<Harness initialValue="grid" />);

      tab("Grid").focus();
      fireEvent.keyDown(tab("Grid"), { key: "End" });
      expect(tab("Table")).toHaveFocus();
      fireEvent.keyDown(tab("Table"), { key: "Home" });
      expect(tab("List")).toHaveFocus();

      rerender(<Harness initialValue="grid" orientation="vertical" />);

      fireEvent.keyDown(tab("List"), { key: "End" });
      expect(tab("Table")).toHaveFocus();
      expect(tab("Table")).toHaveAttribute("aria-selected", "true");
    });

    it("steps over a disabled tab rather than landing on it", () => {
      const onChange = vi.fn();
      render(
        <Harness
          orientation="vertical"
          onChange={onChange}
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid", disabled: true },
            { value: "table", label: "Table" },
          ]}
        />,
      );

      const list = tab("List");
      list.focus();

      fireEvent.keyDown(list, { key: "ArrowDown" });

      expect(tab("Table")).toHaveFocus();
      expect(tab("Table")).toHaveAttribute("aria-selected", "true");
      expect(tab("Grid")).toHaveAttribute("aria-selected", "false");
      expect(onChange).toHaveBeenCalledWith("table");
    });

    it("scrolls the moved-to tab into view on the rail variant only", () => {
      const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      const { rerender } = render(<Harness />);

      tab("List").focus();
      focus.mockClear();
      fireEvent.keyDown(tab("List"), { key: "ArrowRight" });

      expect(tab("Grid")).toHaveFocus();
      // The settings rails scroll, so focus must not yank the page and the
      // tab still has to come into view.
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        inline: "nearest",
      });

      rerender(<Harness variant="segmented" />);
      scrollIntoView.mockClear();
      focus.mockClear();

      fireEvent.keyDown(tab("Grid"), { key: "ArrowRight" });

      expect(tab("Table")).toHaveFocus();
      expect(focus).toHaveBeenCalledWith();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("roving stop", () => {
    it("keeps the tab stop on the selected tab", () => {
      render(<Harness initialValue="grid" />);

      expect(tab("Grid")).toHaveAttribute("tabindex", "0");
      expect(tab("List")).toHaveAttribute("tabindex", "-1");
      expect(tab("Table")).toHaveAttribute("tabindex", "-1");
    });

    it("keeps the strip reachable when the value matches no option, without touching the value", () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <TabRail
          aria-label="View"
          options={defaultOptions}
          value={"missing" as View}
          onChange={onChange}
        />,
      );

      for (const element of screen.getAllByRole("tab")) {
        expect(element).toHaveAttribute("aria-selected", "false");
      }
      expect(tab("List")).toHaveAttribute("tabindex", "0");
      expect(tab("Grid")).toHaveAttribute("tabindex", "-1");
      expect(onChange).not.toHaveBeenCalled();

      rerender(
        <TabRail
          aria-label="View"
          options={[
            { value: "list", label: "List", disabled: true },
            { value: "grid", label: "Grid" },
            { value: "table", label: "Table" },
          ]}
          value={"missing" as View}
          onChange={onChange}
        />,
      );

      expect(tab("List")).toHaveAttribute("tabindex", "-1");
      expect(tab("Grid")).toHaveAttribute("tabindex", "0");
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the stop reachable and the keys working after an option leaves", () => {
      const onChange = vi.fn();
      const { rerender } = render(
        <Harness initialValue="table" onChange={onChange} />,
      );

      expect(tab("Table")).toHaveAttribute("tabindex", "0");

      // A feature flag hides the selected tab; the caller keeps its value.
      rerender(
        <Harness
          initialValue="table"
          onChange={onChange}
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
          ]}
        />,
      );

      expect(
        screen.queryByRole("tab", { name: "Table" }),
      ).not.toBeInTheDocument();
      expect(tab("List")).toHaveAttribute("tabindex", "0");
      expect(tab("List")).toHaveAttribute("aria-selected", "false");
      expect(onChange).not.toHaveBeenCalled();

      tab("List").focus();
      fireEvent.keyDown(tab("List"), { key: "ArrowRight" });

      expect(tab("Grid")).toHaveFocus();
      expect(tab("Grid")).toHaveAttribute("aria-selected", "true");
      expect(onChange).toHaveBeenCalledWith("grid");
    });
  });

  describe("disabled", () => {
    it("dims the track when a segmented strip is disabled", () => {
      render(<Harness variant="segmented" disabled />);

      expect(rail()).toHaveClass("cursor-not-allowed", "opacity-50");
      for (const element of screen.getAllByRole("tab")) {
        expect(element).toBeDisabled();
        expect(element).toHaveClass("cursor-not-allowed");
        expect(element).not.toHaveClass("opacity-50");
      }
    });

    it("dims each tab when a rail is disabled", () => {
      render(<Harness disabled />);

      expect(rail()).not.toHaveClass("cursor-not-allowed", "opacity-50");
      for (const element of screen.getAllByRole("tab")) {
        expect(element).toBeDisabled();
        expect(element).toHaveClass("cursor-not-allowed", "opacity-50");
        expect(element).not.toHaveClass("cursor-pointer");
      }
    });

    it("disables a single option natively, per variant", () => {
      const options: TabRailOption<View>[] = [
        { value: "list", label: "List" },
        { value: "grid", label: "Grid", disabled: true },
      ];
      const { rerender } = render(<Harness options={options} />);

      expect(tab("Grid")).toBeDisabled();
      expect(tab("Grid")).toHaveClass("cursor-not-allowed", "opacity-50");
      expect(tab("List")).toBeEnabled();
      expect(tab("Grid")).not.toHaveClass("cursor-pointer");
      expect(tab("List")).toHaveClass("cursor-pointer");
      expect(tab("List")).not.toHaveClass("opacity-50");

      rerender(<Harness options={options} variant="segmented" />);

      expect(tab("Grid")).toBeDisabled();
      expect(tab("Grid")).toHaveClass("cursor-not-allowed");
      expect(tab("Grid")).not.toHaveClass("opacity-50");
      expect(rail()).not.toHaveClass("opacity-50");
    });
  });

  describe("click", () => {
    it("reports a click on an enabled tab and nothing on a disabled one", () => {
      const onChange = vi.fn();
      render(
        <Harness
          onChange={onChange}
          options={[
            { value: "list", label: "List" },
            { value: "grid", label: "Grid" },
            { value: "table", label: "Table", disabled: true },
          ]}
        />,
      );

      fireEvent.click(tab("Grid"));
      expect(onChange).toHaveBeenCalledWith("grid");
      expect(tab("Grid")).toHaveAttribute("aria-selected", "true");

      fireEvent.click(tab("Table"));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
