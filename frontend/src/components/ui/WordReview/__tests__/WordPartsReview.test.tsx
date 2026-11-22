import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
  structure: { moved: [3], merged: [6], renamed: [3] },
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

const line = () => screen.getByTestId("word-plan-not-changed");

describe("the rows of a change in parts", () => {
  it("marks each row by its own title as ready or removed and names what stays in one line, nothing red", () => {
    const { container } = render(
      <WordPartsReview
        progress={finished}
        title="Changes in 5 sections"
        changes={new Map([[2, [change]]])}
      />,
      { wrapper },
    );
    expect(screen.getByText("2 of 4 sections ready")).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Sections" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "§ 3 LieferungReady",
      "§ 5 Abnahme",
      "§ 7 Haftung, § 9 SchlussReady",
      "§ 11 Gewährleistung",
      "§ 12 SonstigesRemoved",
    ]);
    expect(line()).toHaveTextContent(
      "Not changed: § 5 Abnahme (changed in Word), § 11 Gewährleistung. Ask for them in your next message.",
    );
    expect(container.querySelector(".bg-theme-error-bg")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Leave out|Include|Redo|Write the missing|reordering/,
      }),
    ).toBeNull();
    expect(within(row("§ 5 Abnahme")).queryByRole("button")).toBeNull();
    fireEvent.click(within(row("§ 3 Lieferung")).getByRole("button"));
    expect(row("§ 3 Lieferung")).toHaveTextContent(
      "Lieferung innerhalb von 14 Tagen.",
    );
  });

  it("shows only the intent, the count and each title marked writing or ready while Erato writes", () => {
    render(
      <WordPartsReview
        progress={{
          ...finished,
          finished: undefined,
          rows: [
            finished.rows[0],
            { ...finished.rows[2], state: "writing" },
            { ...finished.rows[3], state: "writing" },
          ],
        }}
        title="Writing the changes"
      />,
      { wrapper },
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 of 3 sections ready",
    );
    expect(
      screen.getByText("Plain wording; § 4 and § 6 swap places."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Sections" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "§ 3 LieferungReady",
      "§ 7 Haftung, § 9 SchlussWriting…",
      "§ 11 GewährleistungWriting…",
    ]);
    expect(screen.queryByTestId("word-plan-not-changed")).toBeNull();
    expect(screen.queryByText("Structure")).toBeNull();
  });

  it("puts Check first above the Apply on top, and a risk without a row as plain text", () => {
    render(
      <WordPartsReview
        progress={finished}
        title="Changes"
        top={<button type="button">Apply</button>}
        changes={new Map([[2, [change]]])}
        risks={[
          {
            kind: "headings-lost",
            count: 1,
            items: [{ rowKey: change.key, text: "§ 3 Lieferung" }],
            rowKey: change.key,
          },
          {
            kind: "sections-removed",
            count: 1,
            items: [{ rowKey: "section-removed:s1" }],
            rowKey: "section-removed:s1",
          },
        ]}
      />,
      { wrapper },
    );
    const alert = screen.getByText("Check first");
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(
      alert.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /no longer in the document/ }),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /section break/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /no longer in the document/ }),
    );
    expect(row("§ 3 Lieferung")).toHaveTextContent(
      "Lieferung innerhalb von 14 Tagen.",
    );
  });

  it("counts and marks nothing once Erato stopped", () => {
    const { container } = render(
      <WordPartsReview
        progress={{
          ...finished,
          finished: undefined,
          stopped: true,
          rows: [
            { ...finished.rows[0], state: "ready" },
            { ...finished.rows[3], state: "not-written" },
          ],
        }}
        title="Changes not finished"
      />,
      { wrapper },
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(row("§ 3 Lieferung").textContent).toBe("§ 3 Lieferung");
    expect(container.querySelector(".bg-theme-success-bg")).toBeNull();
    expect(screen.queryByTestId("word-plan-not-changed")).toBeNull();
  });

  it("names the order of the sections and the merge the finish left out, once, in the same line", () => {
    render(
      <WordPartsReview
        progress={{ ...finished, reorderingLeftOut: "changed_in_word" }}
        title="Changes"
        notChanged={[
          "§ 5 Abnahme",
          "§ 1 Gegenstand",
          "§ 2 Begriffe",
          "§ 13 Geheimhaltung",
        ]}
      />,
      { wrapper },
    );
    expect(row("§ 7 Haftung, § 9 Schluss").textContent).toBe(
      "§ 7 Haftung, § 9 Schluss",
    );
    expect(line()).toHaveTextContent(
      "Not changed: the order of the sections (changed in Word), § 5 Abnahme (changed in Word), § 7 Haftung, § 9 Schluss, § 11 Gewährleistung, § 1 Gegenstand and 2 more. Ask for them in your next message.",
    );
  });

  it("names a row the checks refused without a reason, and adds parts the proposal names besides", () => {
    render(
      <WordPartsReview
        progress={{
          ...finished,
          rows: [
            finished.rows[0],
            { ...finished.rows[2], state: "left-out" },
            finished.rows[4],
          ],
        }}
        title="Changes"
        notChanged={["§ 7 Haftung, § 9 Schluss", "§ 1 Gegenstand"]}
      />,
      { wrapper },
    );
    expect(row("§ 7 Haftung, § 9 Schluss").textContent).toBe(
      "§ 7 Haftung, § 9 Schluss",
    );
    expect(line()).toHaveTextContent(
      "Not changed: § 7 Haftung, § 9 Schluss, § 1 Gegenstand. Ask for them in your next message.",
    );
  });

  it("puts the one line right under Apply, says it for one name and names an untitled section once", () => {
    render(
      <WordPartsReview
        progress={{
          ...finished,
          rows: [
            finished.rows[0],
            { row: 9, action: "rewrite", title: "", state: "not-written" },
          ],
        }}
        title="Changes"
        top={<button type="button">Apply</button>}
        notChanged={[""]}
      />,
      { wrapper },
    );
    expect(line()).toHaveTextContent(
      "Not changed: Text without a title. Ask for it in your next message.",
    );
    const apply = screen.getByRole("button", { name: "Apply" });
    const rows = screen.getByRole("list", { name: "Sections" });
    expect(
      apply.compareDocumentPosition(line()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      line().compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("marks a kept section that moves or gets a new title, and draws no list without rows", () => {
    render(
      <WordPartsReview
        progress={{
          ...finished,
          rows: [
            { row: 3, action: "keep", title: "§ 6 Lagerung", state: "ready" },
            { row: 5, action: "keep", title: "§ 2 Preise", state: "ready" },
          ],
          structure: { moved: [5], merged: [], renamed: [3] },
        }}
        title="Changes"
      />,
      { wrapper },
    );
    expect(
      within(screen.getByRole("list", { name: "Sections" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["§ 6 LagerungRenamed", "§ 2 PreiseMoved"]);
    cleanup();

    render(
      <WordPartsReview
        progress={{ ...finished, rows: [], intent: "Shorter." }}
        title="Shorter."
      />,
      { wrapper },
    );
    expect(screen.queryByRole("list", { name: "Sections" })).toBeNull();
    expect(screen.getAllByText("Shorter.")).toHaveLength(1);
  });
});
