import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { WordPartsReview } from "../WordPartsReview";

import type { WordPartsProgress } from "@/lib/wordReview/wordPartsProgress";
import type { WordPlanRow } from "@/lib/wordReview/wordPlanReview";
import type { PropsWithChildren } from "react";

const wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider
    enableCustomTheme={false}
    initialThemeMode="light"
    persistThemeMode={false}
    persistTextSize={false}
  >
    {children}
  </ThemeProvider>
);

const finished: WordPartsProgress = {
  key: "",
  callId: "plan",
  draftId: "draft",
  intent: "Plain wording; § 4 and § 6 swap places.",
  rows: [
    { row: 2, action: "rewrite", title: "§ 3 Lieferung", state: "ready" },
    {
      row: 4,
      action: "rewrite",
      title: "§ 5 Abnahme",
      state: "changed-in-word",
    },
    {
      row: 6,
      action: "rewrite",
      title: "§ 7 Haftung, § 9 Schluss",
      state: "ready",
    },
    {
      row: 7,
      action: "rewrite",
      title: "§ 11 Gewährleistung",
      state: "not-written",
    },
    { row: 8, action: "delete", title: "§ 12 Sonstiges", state: "ready" },
  ],
  structure: {
    moves: [{ row: 3, title: "§ 6 Lagerung", after: "§ 3 Lieferung" }],
    merges: [{ row: 6, title: "§ 7 Haftung, § 9 Schluss" }],
    renames: [{ row: 3, title: "§ 6 Lagerung", newTitle: "§ 4 Lagerung" }],
  },
  finishing: false,
  finished: "finish",
  stopped: false,
};

const change: WordPlanRow = {
  key: "output:r2_2_1",
  family: "text",
  status: "changed",
  blockType: "paragraph",
  before: "Der Auftragnehmer liefert binnen 14 Tagen nach Bekanntwerden.",
  after: {
    id: "r2_2_1",
    type: "paragraph",
    text: "Lieferung innerhalb von 14 Tagen.",
  },
};

const row = (name: string) =>
  within(screen.getByRole("list", { name: "Sections" }))
    .getAllByRole("listitem")
    .find((item) => item.textContent?.startsWith(name))!;

afterEach(cleanup);

describe("the rows of a change in parts", () => {
  it("names each row by its own title, with the structure, gaps and states, nothing red", () => {
    const { container } = render(
      <WordPartsReview
        progress={finished}
        title="Changes in 5 sections"
        changes={new Map([[2, [change]]])}
        leftOut={{ rows: new Set(), structure: false }}
        onLeaveOut={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("2 of 4 sections ready")).toBeInTheDocument();
    expect(row("Structure")).toHaveTextContent(
      "Structure1 move, 1 merge, 1 renamed headingReady",
    );
    expect(row("§ 5 Abnahme")).toHaveTextContent(
      "Changed in Word while Erato wrote itLeft out",
    );
    expect(row("§ 11 Gewährleistung")).toHaveTextContent("Not written");
    expect(row("§ 12 Sonstiges")).toHaveTextContent("Removed");
    expect(
      screen.getByText("Erato didn't get to § 11 Gewährleistung."),
    ).toBeInTheDocument();
    expect(container.querySelector(".bg-theme-error-bg")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Write the missing|Redo/ }),
    ).toBeNull();

    fireEvent.click(within(row("Structure")).getByRole("button"));
    expect(row("Structure")).toHaveTextContent(
      "§ 6 Lagerung now comes after § 3 Lieferung.",
    );
    expect(row("Structure")).toHaveTextContent(
      "Merged into one section: § 7 Haftung, § 9 Schluss.",
    );
    expect(row("Structure")).toHaveTextContent(
      "§ 6 Lagerung is renamed § 4 Lagerung.",
    );
    fireEvent.click(within(row("§ 3 Lieferung")).getByRole("button"));
    expect(row("§ 3 Lieferung")).toHaveTextContent(
      "Lieferung innerhalb von 14 Tagen.",
    );
  });

  it("leaves rows and the reordering out, with the merged rows going along", () => {
    const onLeaveOut = vi.fn();
    const { rerender } = render(
      <WordPartsReview
        progress={finished}
        title="Changes"
        leftOut={{ rows: new Set(), structure: false }}
        onLeaveOut={onLeaveOut}
      />,
      { wrapper },
    );
    fireEvent.click(within(row("Structure")).getByRole("button"));
    fireEvent.click(
      screen.getByRole("button", { name: "Leave out the reordering" }),
    );
    expect(onLeaveOut).toHaveBeenLastCalledWith("structure", true);
    fireEvent.click(within(row("§ 12 Sonstiges")).getByRole("button"));
    fireEvent.click(
      within(row("§ 12 Sonstiges")).getByRole("button", { name: "Leave out" }),
    );
    expect(onLeaveOut).toHaveBeenLastCalledWith(8, true);

    rerender(
      <WordPartsReview
        progress={finished}
        title="Changes"
        leftOut={{ rows: new Set([8]), structure: true }}
        onLeaveOut={onLeaveOut}
      />,
    );
    expect(row("Structure")).toHaveTextContent("Left out");
    expect(row("§ 7 Haftung, § 9 Schluss")).toHaveTextContent(
      "Left out with the reorderingLeft out",
    );
    expect(row("§ 12 Sonstiges")).toHaveTextContent("Left out");
    fireEvent.click(
      within(row("§ 12 Sonstiges")).getByRole("button", {
        name: "Include again",
      }),
    );
    expect(onLeaveOut).toHaveBeenLastCalledWith(8, false);
  });

  it("offers the follow-up actions only through their hooks", () => {
    const onRedo = vi.fn();
    const onWriteMissing = vi.fn();
    render(
      <WordPartsReview
        progress={finished}
        title="Changes"
        onRedo={onRedo}
        onWriteMissing={onWriteMissing}
      />,
      { wrapper },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Write the missing sections" }),
    );
    expect(onWriteMissing).toHaveBeenCalledOnce();
    fireEvent.click(within(row("§ 5 Abnahme")).getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Redo § 5 Abnahme" }));
    expect(onRedo).toHaveBeenCalledWith(finished.rows[1]);
  });
});
