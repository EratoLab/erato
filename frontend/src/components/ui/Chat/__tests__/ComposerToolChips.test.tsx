import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ComposerToolChips } from "../ComposerToolChips";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Messages } from "@lingui/core";

const facet = (id: string, display_name: string): FacetInfo =>
  ({ id, display_name, icon: "iconoir-globe" }) as FacetInfo;

const tools = [
  facet("web_search", "Web search"),
  facet("thinking", "Extended thinking"),
  facet("code", "Code"),
];

const Harness = ({
  initial,
  locked,
  lockReason,
  onFocusAfterLast,
}: {
  initial: FacetInfo[];
  locked?: boolean;
  lockReason?: string;
  onFocusAfterLast?: () => void;
}) => {
  const [selected, setSelected] = useState(initial);
  return (
    <I18nProvider i18n={i18n}>
      <button type="button">Add files and tools</button>
      <ComposerToolChips
        facets={selected}
        onDeselect={(id) =>
          setSelected((current) => current.filter((item) => item.id !== id))
        }
        locked={locked}
        lockReason={lockReason}
        onFocusAfterLast={onFocusAfterLast}
      />
    </I18nProvider>
  );
};

const live = () =>
  document.querySelector('[data-ui="composer-tool-live"]')!.textContent;

describe("ComposerToolChips", () => {
  beforeAll(() => {
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("names the group and each chip by what its click does", () => {
    render(<Harness initial={tools} />);
    const group = screen.getByRole("group", { name: "Selected tools" });
    expect(group).not.toHaveStyle({ display: "contents" });
    expect(
      screen
        .getAllByRole("button", { name: /^Deselect/ })
        .map((chip) => chip.getAttribute("aria-label")),
    ).toEqual([
      "Deselect Web search",
      "Deselect Extended thinking",
      "Deselect Code",
    ]);
    expect(screen.getByTestId("selected-facet-web_search")).toHaveTextContent(
      "Web search",
    );
  });

  it("deselects, announces, and moves focus to the next, then the previous chip", () => {
    render(<Harness initial={tools} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect Web search" }),
    );
    expect(live()).toBe("Web search deselected.");
    expect(
      screen.getByRole("button", { name: "Deselect Extended thinking" }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Deselect Code" }));
    expect(
      screen.getByRole("button", { name: "Deselect Extended thinking" }),
    ).toHaveFocus();
  });

  it("hands focus on after the last chip and keeps its announcement", () => {
    const onFocusAfterLast = vi.fn(() =>
      screen.getByRole("button", { name: "Add files and tools" }).focus(),
    );
    render(
      <Harness initial={[tools[0]]} onFocusAfterLast={onFocusAfterLast} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Deselect Web search" }),
    );

    expect(screen.queryByRole("group")).toBeNull();
    expect(live()).toBe("Web search deselected.");
    expect(onFocusAfterLast).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Add files and tools" }),
    ).toHaveFocus();
  });

  it("draws an x on a chip that can be deselected", () => {
    render(<Harness initial={tools.slice(0, 1)} />);
    const chip = screen.getByRole("button", { name: "Deselect Web search" });
    expect(
      chip.querySelector('[data-ui="composer-tool-chip-x"]'),
    ).not.toBeNull();
    expect(
      chip.querySelector('[data-ui="composer-tool-chip-lock"]'),
    ).toBeNull();
  });

  it("renders only its live region with no tool selected", () => {
    const { container } = render(<Harness initial={[]} />);
    expect(screen.queryByRole("group")).toBeNull();
    expect(
      container.querySelector('[data-ui="composer-tool-live"]'),
    ).not.toBeNull();
  });

  it("says why an assistant's tools cannot be deselected", () => {
    render(
      <Harness
        initial={tools.slice(0, 2)}
        locked
        lockReason="This assistant sets the tools for its chats."
      />,
    );
    const chip = screen.getByRole("button", { name: "Deselect Web search" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).toHaveAttribute(
      "title",
      "This assistant sets the tools for its chats.",
    );
    expect(chip).toHaveAccessibleDescription(
      "This assistant sets the tools for its chats.",
    );
    // The lane's lock mark, not an x that does nothing.
    expect(
      chip.querySelector('[data-ui="composer-tool-chip-lock"]'),
    ).not.toBeNull();
    expect(chip.querySelector('[data-ui="composer-tool-chip-x"]')).toBeNull();

    fireEvent.click(chip);
    expect(screen.getAllByRole("button", { name: /^Deselect/ })).toHaveLength(
      2,
    );
    expect(live()).toBe("");
  });

  it("is disabled without a description while the composer is busy", () => {
    render(<Harness initial={tools.slice(0, 1)} locked />);
    const chip = screen.getByRole("button", { name: "Deselect Web search" });
    expect(chip).toHaveAttribute("aria-disabled", "true");
    expect(chip).not.toHaveAttribute("aria-describedby");
    expect(chip).toHaveAttribute("title", "Deselect Web search");
  });
});
