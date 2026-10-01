import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";

import { WordCheckFirst, WordUndoLine } from "../WordReviewCardParts";

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

afterEach(cleanup);

describe("WordReviewCardParts", () => {
  it("shows the undo line only while the revert slot is available", () => {
    const onUndo = vi.fn();
    const view = render(
      <WordUndoLine
        canRevert={false}
        label="Undo"
        disabled={false}
        onUndo={onUndo}
      />,
      { wrapper },
    );
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    view.rerender(
      <WordUndoLine canRevert label="Undo" disabled={false} onUndo={onUndo} />,
    );
    expect(
      screen.getByText(
        "Undo available until another change is applied or the pane is closed.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("links each Check first risk to its row", () => {
    const onJump = vi.fn();
    render(
      <WordCheckFirst
        risks={[
          {
            kind: "headings-lost",
            count: 2,
            rowKey: "keep:b3",
            items: [{ rowKey: "keep:b3" }, { rowKey: "keep:b7" }],
          },
          {
            kind: "parts-changed",
            count: 1,
            rowKey: "story:footer",
            items: [{ rowKey: "story:footer", storyType: "footer" }],
          },
        ]}
        onJump={onJump}
      />,
      { wrapper },
    );
    expect(screen.getByText("Check first")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "2 headings are no longer in the document",
      }),
    );
    expect(onJump).toHaveBeenCalledWith("keep:b3");
    fireEvent.click(screen.getByRole("button", { name: /Document parts/ }));
    expect(onJump).toHaveBeenLastCalledWith("story:footer");
  });

  it("renders nothing for Check first without risks", () => {
    const { container } = render(
      <WordCheckFirst risks={[]} onJump={() => {}} />,
      { wrapper },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
