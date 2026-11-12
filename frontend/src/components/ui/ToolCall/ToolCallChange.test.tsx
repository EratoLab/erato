import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { readChange } from "@/lib/toolCallGist/change";
import { messages as enMessages } from "@/locales/en/messages.json";

import { ToolCallChangeCard, ToolCallChangeRowDetails } from "./ToolCallChange";

import type { GistChange } from "@/lib/toolCallGist/change";
import type { Gist } from "@/lib/toolCallGist/gist";
import type { Messages } from "@lingui/core";

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
}));

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

const UUID = "aaaaaaaa-0000-4000-8000-0000000000a1";

const gistFor = (change: GistChange): Gist => ({
  action: "update",
  kind: "row",
  items: [
    {
      names: [],
      count: 1,
      hiddenIdPaths: ["/recordId"],
      where: [
        { text: "Verkaufschance", origin: "place", path: "", truncated: false },
      ],
      whereOmitted: 0,
      before: [],
      after: [],
      fields: [],
    },
  ],
  warnings: [],
  hiddenCharacters: false,
  leavesOutConsent: false,
  change,
});

const readAs = (raw: object): GistChange => {
  const change = readChange({ complete: true, counts: {}, ...raw });
  if (!change) throw new Error("no change");
  return change;
};

const renderCard = (raw: object, placeInSource = false) => {
  const change = readAs(raw);
  return render(
    <I18nProvider i18n={i18n}>
      <ToolCallChangeCard
        gist={gistFor(change)}
        change={change}
        phase="ask"
        placeInSource={placeInSource}
      />
    </I18nProvider>,
  );
};

const set = (index: number) => ({
  path: `/f${index}`,
  name: `Field ${index}`,
  raw_name: `ppt_field_${index}`,
  effect: "set",
  values: [{ text: `v${index}` }],
});

describe("the change card", () => {
  it("says the sentence without the machine id and states what is collapsed", () => {
    const effects = Array.from({ length: 30 }, (_, index) => set(index));
    renderCard({
      effects,
      counts: { set: 30 },
    });
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Update row in Verkaufschance",
    );
    expect(document.body.textContent).not.toContain(UUID);
    expect(screen.getAllByTestId("tool-call-change-row")).toHaveLength(5);
    expect(
      screen.getByText(
        /See 25 more fields, all set with the old value unknown/,
      ),
    ).toBeInTheDocument();
    // Its label names what it holds; past eight names the rest are counted.
    const seeMore = screen.getByRole("button", { name: /See 25 more fields/ });
    expect(seeMore).toHaveTextContent(
      /· Field 5, Field 6, Field 7, Field 8, Field 9, Field 10, Field 11, Field 12 \+17$/,
    );
    expect(screen.queryByText(/These fields/)).toBeNull();
    expect(screen.queryByText("ppt_field_6")).not.toBeInTheDocument();
    fireEvent.click(seeMore);
    expect(screen.getByText("ppt_field_6")).toBeInTheDocument();
  });

  it("opens the collapsed part by default when not everything was read", () => {
    const effects = Array.from({ length: 8 }, (_, index) => set(index));
    renderCard({ effects, counts: { set: 8 }, complete: false });
    expect(screen.getByTestId("tool-call-change-see-more")).toHaveAttribute(
      "data-open",
      "true",
    );
  });

  it("shows emptied values and what a replaced list loses before any value", () => {
    renderCard({
      effects: [
        set(1),
        {
          path: "/owner",
          name: "Owner",
          raw_name: "owner",
          effect: "emptied",
          old: { text: "Tess" },
        },
        {
          path: "/labels",
          name: "Labels",
          raw_name: "labels",
          effect: "list_replaced",
          values: [{ text: "bug" }],
          removed: [{ text: "p1" }, { text: "backend" }],
          kept: [{ text: "bug" }],
        },
      ],
      counts: { set: 1, emptied: 1, list_replaced: 1 },
      notes: ["tool_says_replaces_list", "old_values_from_earlier"],
    });
    const emptied = screen.getByTestId("tool-call-change-emptied");
    expect(emptied).toHaveTextContent("Owner (was Tess)");
    // The rows say what goes and what stays; no line above them repeats it.
    expect(screen.queryByText(/is replaced:/)).toBeNull();
    expect(screen.getByTestId("tool-call-change-list")).toHaveTextContent(
      "p1, backend",
    );
    expect(
      within(screen.getByTestId("tool-call-change-losses")).getByTestId(
        "tool-call-change-row-note",
      ),
    ).toHaveTextContent("The tool says it replaces the current list.");
    const notes = screen.getByTestId("tool-call-change-notes");
    expect(notes).not.toHaveTextContent("replaces the current list");
    expect(notes).toHaveTextContent("Old values are from earlier in this chat");
    const scroll = screen.getByTestId("tool-call-gist-scroll");
    const text = scroll.textContent ?? "";
    expect(text.indexOf("Emptied")).toBeLessThan(text.indexOf("Field 1"));
  });

  it("shows a machine id value as a phrase, a known name as the name", () => {
    renderCard({
      effects: [
        {
          path: "/ownerid",
          name: "Owner ID",
          raw_name: "ownerid",
          effect: "set",
          values: [{ text: "", machine_id: true }],
        },
        {
          path: "/account",
          name: "Account",
          raw_name: "accountid@odata.bind",
          effect: "set",
          link: true,
          values: [{ text: "Contoso", machine_id: true }],
        },
        {
          path: "/parent",
          name: "Parent",
          raw_name: "parent@odata.bind",
          effect: "set",
          link: true,
          values: [{ text: "", machine_id: true }],
        },
      ],
      counts: { set: 3 },
    });
    expect(
      screen.getByText("an ID (see Technical details)"),
    ).toBeInTheDocument();
    expect(screen.getByText("link to Contoso")).toBeInTheDocument();
    expect(
      screen.getByText("a link (see Technical details)"),
    ).toBeInTheDocument();
  });

  it("says who it reaches and never claims none are outside when it cannot know", () => {
    const groups = [
      {
        name: "To",
        raw_name: "to",
        kind: "to",
        count: 32,
        values: ["a@x.example"],
      },
      {
        name: "Cc",
        raw_name: "copy_to",
        kind: "cc",
        count: 8,
        values: ["b@x.example"],
      },
    ];
    const { unmount } = renderCard({
      recipients: {
        total: 40,
        groups,
        outside: ["ana@fabrikam.example"],
        outside_known: true,
      },
    });
    const part = screen.getByTestId("tool-call-change-recipients");
    expect(part).toHaveTextContent("To 40 addresses: 32 To, 8 Cc");
    expect(part).not.toHaveTextContent("copy_to");
    expect(screen.getByTestId("tool-call-change-outside")).toHaveTextContent(
      "1 address is outside your organisation: ana@fabrikam.example",
    );
    unmount();

    renderCard({
      recipients: { total: 2, groups, outside: [], outside_known: false },
    });
    expect(screen.queryByTestId("tool-call-change-outside")).toBeNull();
    expect(document.body.textContent).not.toContain("outside");
  });

  it("says first when a call could not be read in full, without opening anything", () => {
    renderCard({
      complete: false,
      filter: {
        parts: [{ name: "Stage", value: { text: "open" } }],
        omitted: 3,
      },
      opaque_omitted: 2,
      texts_omitted: 1,
    });
    const alert = screen.getByTestId("tool-call-change-incomplete");
    expect(alert).toHaveTextContent("too large to read in full");
    expect(alert).toHaveTextContent(
      "Not shown here: 3 conditions, 2 statements, 1 text.",
    );
    expect(screen.getByTestId("tool-call-change-filter")).toHaveTextContent(
      "+3",
    );
  });

  it("shows no incomplete warning for a call read in full", () => {
    renderCard({ effects: [set(0)], counts: { set: 1 } });
    expect(screen.queryByTestId("tool-call-change-incomplete")).toBeNull();
  });

  it("keeps what is lost above long text and statements", () => {
    renderCard({
      effects: [
        {
          path: "/owner",
          name: "Owner",
          raw_name: "owner",
          effect: "emptied",
        },
      ],
      counts: { emptied: 1 },
      opaque: [
        {
          kind: "sql",
          name: "Query",
          raw_name: "sql",
          path: "/sql",
          text: "update t set a = 1",
          lines: 1,
        },
      ],
      texts: [
        {
          path: "/body",
          name: "Body",
          raw_name: "body",
          text: "line",
          lines: 1,
          chars: 4,
        },
      ],
    });
    const emptied = screen.getByTestId("tool-call-change-emptied");
    const position = (other: HTMLElement) =>
      emptied.compareDocumentPosition(other);
    expect(
      position(screen.getByTestId("tool-call-change-statement")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      position(screen.getByTestId("tool-call-change-text")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows what a replaced list adds next to what it removes and keeps", () => {
    renderCard({
      effects: [
        {
          path: "/owners",
          name: "Owners",
          raw_name: "owners",
          effect: "list_replaced",
          values: [{ text: "Ann" }, { text: "Carl" }],
          removed: [{ text: "Bob" }],
          kept: [{ text: "Ann" }],
          added: [{ text: "Carl" }],
          list: true,
        },
      ],
      counts: { list_replaced: 1 },
    });
    const list = screen.getByTestId("tool-call-change-list");
    expect(within(list).getByText("Owners added")).toBeInTheDocument();
    expect(within(list).getByText("Carl")).toBeInTheDocument();
  });

  it("words a replaced list conditionally when it may only be added to", () => {
    renderCard({
      effects: [
        {
          path: "/labels",
          name: "Labels",
          raw_name: "labels",
          effect: "list_replaced",
          values: [{ text: "bug" }],
          removed: [{ text: "p1" }],
          kept: [{ text: "bug" }],
          list: true,
        },
        {
          path: "/owners",
          name: "Owners",
          raw_name: "owners",
          effect: "list_replaced",
          values: [{ text: "Ann" }],
          list: true,
        },
        set(1),
      ],
      counts: { list_replaced: 2, set: 1 },
      notes: ["list_replace_unknown"],
    });
    expect(screen.queryByText(/If this replaces|is replaced/)).toBeNull();
    const [labels, owners] = screen.getAllByTestId("tool-call-change-list");
    expect(
      within(labels).getByText("Labels that would go"),
    ).toBeInTheDocument();
    expect(
      within(labels).getByText("Labels that would stay"),
    ).toBeInTheDocument();
    expect(within(owners).queryByText("Owners set to")).toBeNull();
    // What could go is not marked as gone.
    expect(within(labels).queryByTestId("tool-call-change-old")).toBeNull();
    expect(
      within(screen.getByTestId("tool-call-change-losses")).getByTestId(
        "tool-call-change-row-note",
      ),
    ).toHaveTextContent(
      "Whether this replaces the current list or adds to it is not known.",
    );
    expect(screen.queryByText(/lists replaced/)).toBeNull();
  });

  it("states a known replacement as a fact", () => {
    renderCard({
      effects: [
        {
          path: "/labels",
          name: "Labels",
          raw_name: "labels",
          effect: "list_replaced",
          values: [{ text: "bug" }],
          removed: [{ text: "p1" }],
          list: true,
        },
      ],
      counts: { list_replaced: 1 },
      notes: ["tool_says_replaces_list"],
    });
    const list = screen.getByTestId("tool-call-change-list");
    expect(within(list).getByText("Labels removed")).toBeInTheDocument();
    expect(within(list).getByText("p1").parentElement).toHaveClass(
      "line-through",
    );
    expect(screen.getByTestId("tool-call-change-row-note")).toHaveTextContent(
      "The tool says it replaces the current list.",
    );
    expect(screen.queryByText(/If this replaces|would go/)).toBeNull();
  });

  it("marks a list the tool says it only adds to as the tool's word", () => {
    renderCard({
      effects: [
        {
          path: "/labels",
          name: "Labels",
          raw_name: "labels",
          effect: "set",
          values: [{ text: "bug" }],
          list: true,
        },
      ],
      counts: { set: 1 },
      notes: ["tool_says_adds_to_list"],
    });
    expect(screen.getByTestId("tool-call-change-claim")).toHaveTextContent(
      "Only added, the tool says",
    );
  });

  it("reads a list the tool says it removes from as removed items, counted as removed", () => {
    renderCard({
      effects: [
        {
          path: "/removeLabels",
          name: "Labels",
          raw_name: "removeLabels",
          effect: "list_removed",
          values: [{ text: "Bug" }],
          list: true,
        },
        {
          path: "/addLabels",
          name: "Labels",
          raw_name: "addLabels",
          effect: "list_added",
          values: [{ text: "Feature" }],
          list: true,
        },
        set(1),
      ],
      counts: { list_removed: 1, list_added: 1, set: 1 },
    });
    const removed = screen.getByTestId("tool-call-change-list");
    expect(within(removed).getByText("Labels removed")).toBeInTheDocument();
    expect(within(removed).getByText("Bug")).toBeInTheDocument();
    expect(
      within(removed).getByTestId("tool-call-change-claim"),
    ).toHaveTextContent("Only removed, the tool says");
    expect(screen.getByText("Labels added")).toBeInTheDocument();
    expect(screen.getByText("Only added, the tool says")).toBeInTheDocument();
    // Every change is a row on the card, so no count repeats them.
    expect(screen.queryByTestId("tool-call-change-summary")).toBeNull();
    expect(screen.queryByText(/maybe replaced|would go|not known/)).toBeNull();
  });

  it("never claims a batch row was emptied in a phrase that reads as its old value", () => {
    renderCard({
      batch: {
        name: "Rows",
        total: 2,
        rows: [
          {
            number: 1,
            effects: [
              {
                path: "/rows/0/owner",
                name: "Owner",
                raw_name: "owner",
                effect: "emptied",
              },
            ],
            effects_omitted: 4,
          },
        ],
        read_all: true,
      },
    });
    const row = screen.getByTestId("tool-call-change-batch-row");
    expect(row).toHaveTextContent("Owner is emptied");
    expect(row).not.toHaveTextContent("was");
    expect(row).toHaveTextContent("+4");
  });

  it("reads an empty filter condition and never leaves a bare Where", () => {
    const { unmount } = renderCard({
      filter: {
        parts: [{ name: "Email", value: { text: "" }, is_empty: true }],
      },
    });
    expect(screen.getByTestId("tool-call-change-filter")).toHaveTextContent(
      "Email is empty",
    );
    unmount();
    renderCard({ filter: { parts: [] } });
    expect(screen.queryByTestId("tool-call-change-filter")).toBeNull();
    expect(document.body.textContent).not.toContain("Where");
  });

  it("turns the mark for a hidden id into words, in values and names", () => {
    renderCard({
      effects: [
        {
          path: "/m",
          name: "\uE002",
          raw_name: "",
          effect: "unreadable",
          values: [{ text: "Owner: \uE002, State: open" }],
        },
      ],
      counts: { unreadable: 1 },
    });
    expect(document.body.textContent).not.toContain("\uE002");
    expect(document.body.textContent).toContain(
      "Owner: an ID (see Technical details), State: open",
    );
  });

  it("states an empty filter as every record", () => {
    renderCard({ filter: { path: "/where", every_record: true } });
    expect(screen.getByTestId("tool-call-change-every-record")).toBeVisible();
  });

  it("shows a statement with what was found in it and marks a cut one", () => {
    renderCard({
      opaque: [
        {
          kind: "sql",
          name: "Query",
          raw_name: "query",
          path: "/query",
          text: "WITH gone AS (DELETE FROM a) SELECT 1",
          lines: 1,
          found: ["DELETE"],
          write_inside_read: true,
          truncated: true,
        },
      ],
      notes: ["row_count_unknown"],
    });
    expect(screen.getByTestId("tool-call-change-found")).toHaveTextContent(
      "Found in this SQL: DELETE",
    );
    expect(screen.getByTestId("tool-call-change-found")).toHaveTextContent(
      "It sits inside a statement that opens like a read.",
    );
    expect(screen.getByTestId("tool-call-change-statement")).toHaveTextContent(
      "WITH gone AS (DELETE FROM a) SELECT 1…",
    );
    expect(
      screen.getByText(
        "Only the start is shown here. Technical details has the rest.",
      ),
    ).toBeInTheDocument();
  });

  it("gives long text more room and offers the rest", () => {
    renderCard({
      texts: [
        {
          path: "/body",
          name: "Body",
          raw_name: "body",
          text: "line\n".repeat(20),
          lines: 21,
          chars: 100,
        },
      ],
    });
    expect(screen.getByTestId("tool-call-change-text-start")).toHaveClass(
      "line-clamp-6",
    );
    fireEvent.click(screen.getByRole("button", { name: /full text/ }));
    expect(screen.queryByTestId("tool-call-change-text-start")).toBeNull();
  });

  it("states a batch per field and whether any row loses something, with numbered rows", () => {
    renderCard({
      batch: {
        path: "/records",
        name: "Records",
        total: 200,
        same_change: false,
        rows: Array.from({ length: 50 }, (_, index) => ({
          number: index + 1,
          effects: [
            {
              path: "/x",
              name: "Stage",
              raw_name: "stage",
              effect: "set",
              values: [{ text: "Won" }],
            },
          ],
        })),
        fields: [
          {
            name: "Stage",
            raw_name: "stage",
            rows: 200,
            distinct: 2,
            samples: [{ text: "Won" }, { text: "Lost" }],
          },
        ],
        rows_emptying: 3,
        read_all: true,
      },
    });
    expect(
      screen.getByTestId("tool-call-change-batch-fields"),
    ).toHaveTextContent("2 different values on all 200 rows: Won, Lost");
    expect(screen.getByTestId("tool-call-change-batch-loss")).toHaveTextContent(
      "3 rows empty a field",
    );
    const rows = screen.getAllByTestId("tool-call-change-batch-row");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("Row 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /See 195 more rows/ }));
    expect(
      screen.getByText("The other 150 rows are in Technical details."),
    ).toBeInTheDocument();
  });

  it("collapses identical rows to one statement and names deletions first", () => {
    const shared = [
      {
        path: "/s",
        name: "Stage",
        raw_name: "stage",
        effect: "set",
        values: [{ text: "Closed" }],
      },
    ];
    const { unmount } = renderCard({
      batch: {
        path: "/r",
        name: "R",
        total: 200,
        same_change: true,
        shared,
        rows: [{ number: 1, effects: shared }],
        read_all: true,
      },
    });
    expect(screen.getByText("Every row changes the same way")).toBeVisible();
    expect(screen.queryByTestId("tool-call-change-batch-row")).toBeNull();
    expect(screen.getByTestId("tool-call-change-batch-loss")).toHaveTextContent(
      "No row deletes or empties anything.",
    );
    unmount();

    // That no row loses anything would be the tool's word, not Erato's.
    const { unmount: unmountClaimed } = renderCard({
      batch: {
        path: "/r",
        name: "R",
        total: 200,
        same_change: true,
        shared,
        rows: [{ number: 1, effects: shared }],
        read_all: true,
      },
      notes: ["tool_says_adds_to_list"],
    });
    expect(screen.queryByTestId("tool-call-change-batch-loss")).toBeNull();
    expect(
      screen.getByText("The tool says it only adds to the list."),
    ).toBeInTheDocument();
    unmountClaimed();

    renderCard({
      batch: {
        path: "/r",
        name: "R",
        total: 3,
        deletions: 2,
        rows: [
          { number: 2, name: "/c2", action: "delete" },
          { number: 3, name: "/c3", action: "delete" },
          { number: 1, name: "/c1", action: "update" },
        ],
        read_all: true,
      },
    });
    expect(screen.getByTestId("tool-call-change-deletions")).toHaveTextContent(
      "2 deletions: /c2, /c3",
    );
  });

  it("heads a mixed batch with its operations and says each loss once, losses first", () => {
    const value = (text: string) => ({
      path: "/value",
      name: "Value",
      raw_name: "value",
      effect: "set",
      values: [{ text }],
    });
    const mixed = {
      batch: {
        path: "/ops",
        name: "Operations",
        total: 5,
        same_change: false,
        rows: [
          { number: 1, name: "/customers/c2", action: "delete" },
          { number: 2, name: "/customers/c3", action: "delete" },
          {
            number: 3,
            name: "/customers",
            action: "create",
            effects: [value("Contoso Test GmbH")],
          },
          {
            number: 4,
            name: "/customers/c1",
            action: "update",
            effects: [value("gold")],
          },
          {
            number: 5,
            name: "/customers/c4",
            action: "update",
            effects: [
              {
                path: "/value",
                name: "Value",
                raw_name: "value",
                effect: "emptied",
              },
            ],
          },
        ],
        deletions: 2,
        rows_emptying: 1,
        operations: [
          { action: "create", count: 1 },
          { action: "update", count: 2 },
          { action: "delete", count: 2 },
        ],
        fields: [
          {
            name: "Value",
            raw_name: "value",
            rows: 3,
            emptied: 1,
            distinct: 2,
            samples: [{ text: "Contoso Test GmbH" }, { text: "gold" }],
          },
        ],
        read_all: true,
      },
    };
    // A headline that names where the call goes keeps it.
    const { unmount } = renderCard(mixed);
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /Verkaufschance/,
    );
    unmount();

    renderCard(mixed, true);
    // The operations code counted are the headline, deletes first: "Update"
    // alone would hide the two deletes.
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /^5 operations in one call: 2 delete, 2 update, 1 create$/,
    );
    expect(screen.getByTestId("tool-call-change-batch")).not.toHaveTextContent(
      /operations in one call/,
    );
    expect(screen.getByTestId("tool-call-change-deletions")).toHaveTextContent(
      "2 deletions: /customers/c2, /customers/c3",
    );
    // Every row is in view, so nothing above them repeats what they show.
    expect(screen.queryByTestId("tool-call-change-batch-loss")).toBeNull();
    expect(screen.queryByTestId("tool-call-change-batch-fields")).toBeNull();
    expect(screen.queryByText("Each row is different.")).toBeNull();
    // The named deletions are no rows of their own; the emptied row leads.
    const rows = screen.getAllByTestId("tool-call-change-batch-row");
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual([
      "/customers/c4",
      "/customers/c1",
      "/customers",
    ]);
    expect(screen.queryByRole("button", { name: /See .* more/ })).toBeNull();
  });

  it("makes only overflowing boxes tab stops", () => {
    renderCard({ effects: [set(1)], counts: { set: 1 } });
    expect(screen.getByTestId("tool-call-gist-scroll")).not.toHaveAttribute(
      "tabindex",
    );
  });

  it("never renders markup a value holds", () => {
    renderCard({
      effects: [
        {
          path: "/x",
          name: "<b>Name</b>",
          raw_name: "x",
          effect: "set",
          values: [{ text: "<img src=x onerror=alert(1)>" }],
        },
      ],
      counts: { set: 1 },
    });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
  });
});

describe("old and new values", () => {
  const changed = (extra: object) => ({
    path: "/priority",
    name: "Priority",
    raw_name: "priority",
    effect: "changed",
    values: [{ text: "2" }],
    old: { text: "4" },
    ...extra,
  });

  it("render differently: old struck through in red, new in green", () => {
    renderCard({
      effects: [changed({})],
      counts: { changed: 1 },
      notes: ["old_values_from_earlier"],
    });
    const old = screen.getByTestId("tool-call-change-old");
    const fresh = screen.getByTestId("tool-call-change-new");
    expect(old).toHaveClass("line-through");
    expect(old.className).toContain("--theme-diff-removed-fg");
    expect(fresh).not.toHaveClass("line-through");
    expect(fresh.className).toContain("--theme-diff-added-fg");
    expect(old.className).not.toEqual(fresh.className);
  });

  it("show a code's meaning as the tool's word unless the glossary gives it", () => {
    const { unmount } = renderCard({
      effects: [
        changed({
          old: {
            text: "4",
            meaning: { label: "Low", source: "earlier" },
          },
          values: [{ text: "2", meaning: { label: "High", source: "tool" } }],
        }),
      ],
      counts: { changed: 1 },
    });
    expect(screen.getByTestId("tool-call-change-old")).toHaveTextContent(
      "4 (the tool says: Low)",
    );
    expect(screen.getByTestId("tool-call-change-new")).toHaveTextContent(
      "2 (the tool says: High)",
    );
    unmount();
    renderCard({
      effects: [
        changed({
          values: [
            { text: "2", meaning: { label: "High", source: "glossary" } },
          ],
        }),
      ],
      counts: { changed: 1 },
    });
    expect(screen.getByTestId("tool-call-change-new")).toHaveTextContent(
      "High (2)",
    );
  });

  it("mark a meaning from an earlier read as such", () => {
    renderCard({
      effects: [
        changed({
          old: { text: "4", meaning: { label: "Low", source: "earlier" } },
        }),
      ],
      counts: { changed: 1 },
    });
    const old = screen
      .getByTestId("tool-call-change-old")
      .querySelector("[data-origin]");
    expect(old).toHaveAttribute("data-origin", "earlier");
    expect(old).toHaveClass("decoration-dotted");
  });

  it("leave a code alone when nobody says what it means", () => {
    renderCard({
      effects: [
        {
          ...set(1),
          values: [{ text: "8" }],
        },
      ],
      counts: { set: 1 },
    });
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.queryByText(/says/)).toBeNull();
  });

  it("show no arrow for a value that stays the same", () => {
    renderCard({
      effects: [
        changed({
          effect: "unchanged",
          values: [{ text: "4", meaning: { label: "Low", source: "earlier" } }],
          old: { text: "4", meaning: { label: "Low", source: "earlier" } },
        }),
      ],
      counts: { unchanged: 1 },
    });
    expect(screen.queryByTestId("tool-call-change-old")).toBeNull();
    expect(screen.getByTestId("tool-call-change-row")).toHaveTextContent(
      "Priority4 (the tool says: Low)",
    );
  });

  it("grey the tool's word around a code's meaning, so the meaning reads first", () => {
    renderCard({
      effects: [
        changed({
          effect: "set",
          values: [
            { text: "8", meaning: { label: "Prospect", source: "tool" } },
          ],
          old: undefined,
        }),
      ],
      counts: { set: 1 },
    });
    const row = screen.getByTestId("tool-call-change-row");
    expect(row).toHaveTextContent("8 (the tool says: Prospect)");
    expect(
      within(row).getByText("(the tool says:", { exact: false }),
    ).toHaveClass("text-theme-fg-muted");
    expect(within(row).getByText("Prospect", { exact: false })).not.toHaveClass(
      "text-theme-fg-muted",
    );
  });

  it("show a trace row's value as it is now, coloured as new", () => {
    const change = readAs({
      effects: [changed({})],
      counts: { changed: 1 },
    });
    render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeRowDetails change={change} />
      </I18nProvider>,
    );
    expect(screen.queryByTestId("tool-call-change-old")).toBeNull();
    expect(screen.getByTestId("tool-call-change-new").className).toContain(
      "--theme-diff-added-fg",
    );
  });
});

describe("a card for something new", () => {
  const renderCreate = (raw: object) => {
    const change = readAs(raw);
    return render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeCard
          gist={{ ...gistFor(change), action: "create" }}
          change={change}
          phase="ask"
        />
      </I18nProvider>,
    );
  };

  it("counts no fields: its rows show every one", () => {
    const effects = Array.from({ length: 7 }, (_, index) => set(index));
    renderCreate({
      effects,
      counts: { set: 7 },
      texts: [
        {
          path: "/d",
          name: "Description",
          raw_name: "description",
          text: "Short text.",
          lines: 1,
          chars: 11,
        },
      ],
    });
    expect(screen.queryByText(/fields are set|fields change/)).toBeNull();
    expect(screen.queryByTestId("tool-call-change-see-more")).toBeNull();
    expect(screen.getAllByTestId("tool-call-change-row")).toHaveLength(8);
  });

  it("never says an old value is unknown or that nothing is emptied", () => {
    const effects = Array.from({ length: 9 }, (_, index) => set(index));
    renderCreate({ effects, counts: { set: 9 } });
    expect(
      screen.getByRole("button", {
        name: "See 4 more fields · Field 5, Field 6, Field 7, Field 8",
      }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("old value unknown");
    expect(document.body.textContent).not.toContain("none is emptied");
  });

  it("gives the size of long text only", () => {
    renderCreate({
      effects: [],
      counts: {},
      texts: [
        {
          path: "/a",
          name: "Description",
          raw_name: "description",
          text: "Artificial test record, safe to delete.",
          lines: 1,
          chars: 39,
        },
        {
          path: "/b",
          name: "Body",
          raw_name: "body",
          text: "x\ny\nz\nw",
          lines: 4,
          chars: 300,
        },
      ],
    });
    const [short, long] = screen.getAllByTestId("tool-call-change-text");
    expect(short).toHaveTextContent(/^Description/);
    expect(short).not.toHaveTextContent("39 characters");
    expect(long).toHaveTextContent("Body: 4 lines, 300 characters");
  });
});

describe("what sits on the card", () => {
  it("gives statements and option chips a surface of their own", () => {
    renderCard({
      effects: [],
      counts: {},
      opaque: [{ kind: "sql", path: "/q", text: "select 1", lines: 1 }],
      flags: [{ name: "Force", raw_name: "force" }],
    });
    expect(screen.getByTestId("tool-call-change-statement")).toHaveClass(
      "bg-theme-bg-tertiary",
    );
    expect(
      within(screen.getByTestId("tool-call-change-flags")).getByText("Force"),
    ).toHaveClass("bg-theme-bg-tertiary");
  });

  it("shows a glossary name with the raw name beside it, and not twice", () => {
    renderCard({
      effects: [
        {
          ...set(1),
          name: "Due (duedate)",
          raw_name: "duedate",
        },
        ...Array.from({ length: 6 }, (_, index) => set(index + 2)),
        { ...set(8), name: "Subject", raw_name: "Subject" },
      ],
      counts: { set: 8 },
    });
    expect(screen.getByText("Due (duedate)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /See 3 more fields/ }));
    expect(screen.queryByText("duedate")).toBeNull();
    expect(screen.getByText("ppt_field_6")).toBeInTheDocument();
    expect(screen.getAllByText("Subject")).toHaveLength(1);
  });

  it("leaves who marked the tool as destructive to the decision area", () => {
    renderCard({
      effects: [set(1)],
      counts: { set: 1 },
      notes: ["operator_marked_destructive", "marked_destructive"],
    });
    expect(document.body.textContent).not.toContain("destructive");
  });
});

describe("a trace row's details", () => {
  it("names the losses, who it reached and the first values", () => {
    const change = readAs({
      effects: [
        {
          path: "/owner",
          name: "Owner",
          raw_name: "owner",
          effect: "emptied",
        },
        {
          path: "/stage",
          name: "Stage",
          raw_name: "stage",
          effect: "changed",
          values: [{ text: "customer" }],
          old: { text: "lead" },
        },
        {
          path: "/id",
          name: "Owner ID",
          raw_name: "owner_id",
          effect: "changed",
          values: [{ text: "", machine_id: true }],
          old: { text: "Tess", machine_id: true },
        },
        set(1),
      ],
      counts: { emptied: 1, changed: 2, set: 1 },
      recipients: {
        total: 2,
        groups: [],
        outside: ["a@x.example"],
        outside_known: true,
      },
    });
    render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeRowDetails change={change} />
      </I18nProvider>,
    );
    const details = screen.getByTestId("tool-call-change-row-details");
    expect(details).toHaveTextContent("Emptied: Owner");
    expect(details).toHaveTextContent("To 2 addresses");
    expect(details).toHaveTextContent("1 address is outside your organisation");
    expect(details).toHaveTextContent("Stage → customer");
    expect(details).not.toHaveTextContent("lead");
    expect(details.tagName).toBe("P");
    expect(details).toHaveTextContent("+1");
    expect(details.textContent).not.toContain(UUID);
  });

  it("lists every list, unreadable value and text its count line counts", () => {
    const change = readAs({
      effects: [
        {
          path: "/removeLabels",
          name: "Labels",
          raw_name: "removeLabels",
          effect: "list_removed",
          values: [{ text: "Bug" }],
          list: true,
        },
        {
          path: "/owners",
          name: "Owners",
          raw_name: "owners",
          effect: "list_replaced",
          values: [{ text: "Ann" }],
          list: true,
        },
        {
          path: "/blob",
          name: "Blob",
          raw_name: "blob",
          effect: "unreadable",
        },
        {
          path: "/priority",
          name: "Priority",
          raw_name: "priority",
          effect: "changed",
          values: [{ text: "4" }],
          old: { text: "3" },
        },
      ],
      texts: [
        {
          path: "/body",
          name: "Body",
          raw_name: "body",
          text: "Hello",
          lines: 1,
          chars: 5,
        },
      ],
      counts: { list_removed: 1, list_replaced: 1, unreadable: 1, changed: 1 },
      notes: ["list_replace_unknown"],
    });
    render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeRowDetails change={change} />
      </I18nProvider>,
    );
    const details = screen.getByTestId("tool-call-change-row-details");
    expect(details).toHaveTextContent("Labels removed: Bug");
    expect(details).toHaveTextContent("Owners: Ann");
    expect(details).toHaveTextContent("Not readable: Blob");
    expect(details).toHaveTextContent("Body");
    expect(details).toHaveTextContent("Priority → 4");
  });
});

describe("what stays outside the card's scroll box", () => {
  it("keeps the footnote and See more after it", () => {
    renderCard({
      effects: Array.from({ length: 30 }, (_, index) => set(index)),
      counts: { set: 30 },
      notes: ["operator_marked_destructive", "old_values_from_earlier"],
    });
    const scroll = screen.getByTestId("tool-call-gist-scroll");
    const seeMore = screen.getByTestId("tool-call-change-see-more");
    const notes = screen.getByTestId("tool-call-change-notes");
    for (const element of [seeMore, notes]) {
      expect(scroll.contains(element)).toBe(false);
      expect(
        scroll.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(notes).not.toHaveTextContent("destructive");
    expect(notes).toHaveTextContent(
      "Old values are from earlier in this chat and may have changed.",
    );
    expect(within(scroll).getAllByTestId("tool-call-change-row")).toHaveLength(
      5,
    );
  });
});

describe("the scroll box", () => {
  it("becomes a named tab stop only when its content overflows", () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(900);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(300);
    renderCard({ effects: [set(1)], counts: { set: 1 } });
    const box = screen.getByTestId("tool-call-gist-scroll");
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAccessibleName("Scrollable details of this call");
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });
});

describe("a card for a record no result in the chat named", () => {
  const renderUnread = (raw: object) => {
    const change = readAs(raw);
    const gist: Gist = {
      ...gistFor(change),
      items: [{ ...gistFor(change).items[0], where: [] }],
    };
    return render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeCard gist={gist} change={change} phase="ask" />
      </I18nProvider>,
    );
  };
  const renamed = (newName: boolean) => ({
    path: "/item/name",
    name: "Name",
    raw_name: "name",
    effect: "set",
    values: [{ text: "Renamed" }],
    new_name: newName,
  });

  it("says under the line that the record was not read, and reads a new name as one", () => {
    renderUnread({
      table: "account",
      record_unread: true,
      effects: [renamed(true)],
      counts: { set: 1 },
    });
    // The table's key goes to the source line; the headline says record.
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /^Update record$/,
    );
    expect(screen.getByTestId("tool-call-gist-unread")).toHaveTextContent(
      "Which record: not read in this chat (its ID is in Technical details)",
    );
    const row = screen.getByTestId("tool-call-change-row");
    expect(row).toHaveTextContent("Nameset to Renamed");
    expect(
      within(row).getByTestId("tool-call-change-new-name"),
    ).toBeInTheDocument();
  });

  it("says neither when the backend does not", () => {
    renderUnread({
      table: "account",
      effects: [renamed(false)],
      counts: { set: 1 },
    });
    expect(screen.queryByTestId("tool-call-gist-unread")).toBeNull();
    expect(screen.queryByTestId("tool-call-change-new-name")).toBeNull();
    expect(screen.getByTestId("tool-call-change-row")).toHaveTextContent(
      "NameRenamed",
    );
  });
});

describe("what the card names when it can only say item", () => {
  const itemGist = (change: GistChange, action: Gist["action"]): Gist => ({
    ...gistFor(change),
    action,
    kind: "other",
    items: [
      {
        ...gistFor(change).items[0],
        names: [
          {
            text: "uploader-archive",
            origin: "written",
            path: "/repo",
            truncated: false,
          },
        ],
        where: [
          { text: "contoso", origin: "place", path: "", truncated: false },
        ],
        hiddenIdPaths: [],
      },
    ],
  });
  const renderItemCard = (
    raw: object,
    action: Gist["action"],
    toolTitle?: string,
  ) => {
    const change = readAs(raw);
    return render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeCard
          gist={itemGist(change, action)}
          change={change}
          phase="ask"
          toolTitle={toolTitle}
        />
      </I18nProvider>,
    );
  };

  it("says the tool's own name for the call as the tool's word", () => {
    renderItemCard(
      { effects: [], counts: {}, place: "contoso" },
      "delete",
      "Delete repository",
    );
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Delete item uploader-archive from contoso",
    );
    expect(screen.getByTestId("tool-call-change-tool-title")).toHaveTextContent(
      "The tool calls this Delete repository",
    );
  });

  it("says none where a type the call names is the noun", () => {
    renderItemCard(
      { effects: [], counts: {}, table: "Namespace" },
      "delete",
      "Resources: Delete",
    );
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Delete Namespace uploader-archive from contoso",
    );
    expect(screen.queryByTestId("tool-call-change-tool-title")).toBeNull();
  });

  it("says none where the line names a statement instead", () => {
    renderItemCard(
      {
        effects: [],
        counts: {},
        opaque: [{ kind: "sql", path: "/q", text: "select 1", lines: 1 }],
      },
      "run",
      "execute_sql",
    );
    expect(screen.queryByTestId("tool-call-change-tool-title")).toBeNull();
  });

  it("counts no fields for a run, whose values are no record's fields", () => {
    renderItemCard(
      { effects: [set(1), set(2)], counts: { set: 2 } },
      "run",
      "exec_op",
    );
    expect(screen.queryByText(/fields are set/)).toBeNull();
    expect(screen.getByTestId("tool-call-change-tool-title")).toHaveTextContent(
      "The tool calls this exec_op",
    );
  });

  it("lists the options a call turns on as turned on", () => {
    renderItemCard(
      {
        effects: [],
        counts: {},
        flags: [
          { name: "Safe preview", raw_name: "safe_preview", dry_run: true },
          { name: "Push to production", raw_name: "push_to_production" },
        ],
      },
      "send",
    );
    expect(screen.getByTestId("tool-call-change-flags")).toHaveTextContent(
      /^Turned on/,
    );
  });

  it("gives the size of a replaced text as the new text's", () => {
    renderItemCard(
      {
        effects: [],
        counts: {},
        texts: [
          {
            path: "/body",
            name: "Body",
            raw_name: "body",
            text: "x\ny\nz\nw",
            lines: 4,
            chars: 300,
          },
        ],
      },
      "update",
    );
    expect(screen.getByTestId("tool-call-change-text")).toHaveTextContent(
      "Body replaced by 4 lines, 300 characters",
    );
  });
});

describe("the card's anatomy", () => {
  const renderAs = (
    raw: object,
    gist: Partial<Gist> = {},
    props: Partial<React.ComponentProps<typeof ToolCallChangeCard>> = {},
  ) => {
    const change = readAs(raw);
    return render(
      <I18nProvider i18n={i18n}>
        <ToolCallChangeCard
          gist={{ ...gistFor(change), ...gist }}
          change={change}
          phase="ask"
          {...props}
        />
      </I18nProvider>,
    );
  };
  const follows = (first: Element, second: Element) =>
    (first.compareDocumentPosition(second) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0;
  const recipients = (
    groups: { kind: string; values: string[] }[],
    outside: string[],
  ) => ({
    total: groups.reduce((sum, group) => sum + group.values.length, 0),
    groups: groups.map((group) => ({ ...group, count: group.values.length })),
    outside,
    outside_known: true,
  });

  it("gives the headline its own size, then the qualifier, the content and one footnote", () => {
    renderAs(
      {
        effects: [
          set(1),
          {
            ...set(2),
            values: [
              { text: "8", meaning: { label: "Prospect", source: "earlier" } },
            ],
          },
        ],
        counts: { set: 2 },
        notes: ["delete_outcome_unknown", "old_values_from_earlier"],
      },
      { action: "delete" },
    );
    const line = screen.getByTestId("tool-call-gist-line");
    expect(line).toHaveClass("text-base", "font-semibold");
    const qualifier = screen.getByTestId("tool-call-change-qualifier");
    expect(qualifier).toHaveTextContent(
      "What else goes with it, and whether it can be restored, is not known.",
    );
    expect(qualifier).toHaveClass("text-sm");
    const scroll = screen.getByTestId("tool-call-gist-scroll");
    const footnote = screen.getByTestId("tool-call-change-notes");
    expect(follows(line, qualifier)).toBe(true);
    expect(follows(qualifier, scroll)).toBe(true);
    expect(follows(scroll, footnote)).toBe(true);
    expect(
      within(scroll).getAllByTestId("tool-call-change-row")[0],
    ).toHaveClass("text-sm");
    // One footnote that also says what the dotted underline means.
    expect(footnote).toHaveTextContent(
      /^Dotted and old values are from earlier in this chat and may have changed\.$/,
    );
  });

  it("names a dotted value's source even without old values", () => {
    renderAs({
      effects: [
        {
          ...set(1),
          values: [
            { text: "8", meaning: { label: "Prospect", source: "earlier" } },
          ],
        },
      ],
      counts: { set: 1 },
    });
    expect(screen.getByTestId("tool-call-change-notes")).toHaveTextContent(
      "Dotted values are from earlier in this chat and may have changed.",
    );
  });

  it("says in amber, under the headline, when the tool says a delete cannot be undone", () => {
    renderAs(
      { effects: [], counts: {}, notes: ["tool_says_permanent"] },
      { action: "delete" },
    );
    const qualifier = screen.getByTestId("tool-call-change-qualifier");
    expect(qualifier).toHaveAttribute("data-tone", "warning");
    expect(screen.getByTestId("tool-call-change-head")).toContainElement(
      qualifier,
    );
  });

  it("lists one to three recipients by address, the outside ones marked with the badge", () => {
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients(
          [{ kind: "to", values: ["ana@fabrikam.example"] }],
          ["ana@fabrikam.example"],
        ),
      },
      { action: "share", kind: "file" },
    );
    const part = screen.getByTestId("tool-call-change-recipients");
    expect(part).toHaveTextContent("With");
    const badge = within(part).getByTestId("tool-call-change-outside-badge");
    expect(badge).toHaveTextContent("outside your organisation");
    expect(badge.querySelector('[data-ui="status-pill"]')).toHaveAttribute(
      "data-tone",
      "warning",
    );
    // The badge wraps under the address when the row is narrow.
    expect(badge.parentElement).toHaveClass("flex-wrap");
    expect(badge.parentElement).toHaveTextContent("ana@fabrikam.example");
    expect(screen.queryByText(/To 1 address/)).toBeNull();
    expect(screen.queryByText(/See the 1 address/)).toBeNull();
    expect(screen.queryByTestId("tool-call-change-outside")).toBeNull();
  });

  it("marks only the addresses outside the organisation", () => {
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients(
          [
            {
              kind: "to",
              values: ["ana@fabrikam.example", "bo@contoso.example"],
            },
            { kind: "cc", values: ["cy@contoso.example"] },
          ],
          ["ana@fabrikam.example"],
        ),
      },
      { action: "send", kind: "email" },
    );
    const part = screen.getByTestId("tool-call-change-recipients");
    expect(
      within(part).getAllByTestId("tool-call-change-outside-badge"),
    ).toHaveLength(1);
    expect(within(part).getByText("Cc")).toBeInTheDocument();
    expect(within(part).getByText("cy@contoso.example")).toBeInTheDocument();
  });

  it("counts four or more by To, Cc and Bcc, keeps the To addresses in view and the rest behind See all", () => {
    const bcc = Array.from({ length: 12 }, (_, index) => `b${index}@x.example`);
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients(
          [
            { kind: "to", values: ["team@x.example"] },
            { kind: "bcc", values: bcc },
          ],
          [],
        ),
      },
      { action: "send", kind: "email" },
    );
    const part = screen.getByTestId("tool-call-change-recipients");
    expect(part).toHaveTextContent("To 13 addresses: 1 To, 12 Bcc");
    const to = within(part).getByTestId("tool-call-change-to");
    expect(
      to.closest('[data-testid="tool-call-change-row"]'),
    ).toHaveTextContent(/^Toteam@x\.example$/);
    expect(to.closest('[data-testid="tool-call-change-see-more"]')).toBeNull();
    expect(screen.queryByText(/b0@x\.example/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "See all 13 addresses" }),
    ).toBeInTheDocument();
  });

  it("names three To addresses as written, counts the rest and names every outside address it does not show", () => {
    const to = [
      ...Array.from({ length: 30 }, (_, index) => `p${index}@x.example`),
      "ana@fabrikam.example",
      "bert@contoso.example",
    ];
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients(
          [
            { kind: "to", values: to },
            { kind: "cc", values: ["c@x.example", "cleo@northwind.example"] },
          ],
          [
            "ana@fabrikam.example",
            "bert@contoso.example",
            "cleo@northwind.example",
          ],
        ),
      },
      { action: "send", kind: "email" },
    );
    const shown = screen.getByTestId("tool-call-change-to");
    expect(shown).toHaveTextContent(
      /^p0@x\.examplep1@x\.examplep2@x\.example \+29$/,
    );
    expect(screen.getByTestId("tool-call-change-outside")).toHaveTextContent(
      "3 addresses are outside your organisation: ana@fabrikam.example, bert@contoso.example, cleo@northwind.example",
    );
    expect(screen.queryByTestId("tool-call-change-outside-badge")).toBeNull();
  });

  it("marks an outside To address it shows with the badge and says it once", () => {
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients(
          [
            {
              kind: "to",
              values: [
                "a@contoso.example",
                "b@contoso.example",
                "ana@fabrikam.example",
              ],
            },
            { kind: "cc", values: ["c@contoso.example"] },
          ],
          ["ana@fabrikam.example"],
        ),
      },
      { action: "send", kind: "email" },
    );
    const part = screen.getByTestId("tool-call-change-recipients");
    expect(part).toHaveTextContent("To 4 addresses: 3 To, 1 Cc");
    const badge = within(part).getByTestId("tool-call-change-outside-badge");
    expect(badge.parentElement).toHaveTextContent("ana@fabrikam.example");
    expect(screen.queryByTestId("tool-call-change-outside")).toBeNull();
    expect(
      screen.getByRole("button", { name: "See all 4 addresses" }),
    ).toBeInTheDocument();
  });

  it("names no address in a mail headline that its recipients list", () => {
    const to = ["ana@fabrikam.example", "bo@contoso.example"];
    renderAs(
      {
        effects: [],
        counts: {},
        recipients: recipients([{ kind: "to", values: to }], []),
      },
      {
        action: "send",
        kind: "email",
        items: [
          {
            ...gistFor(readAs({})).items[0],
            names: [
              {
                text: "Quarterly update",
                origin: "written",
                path: "/subject",
                truncated: false,
              },
            ],
            where: to.map((text, index) => ({
              text,
              origin: "written" as const,
              path: `/to/${index}`,
              truncated: false,
            })),
            hiddenIdPaths: [],
          },
        ],
      },
    );
    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      /^Send email Quarterly update$/,
    );
  });

  it("drops a trailing ID from a link that shows the linked record's name", () => {
    renderAs({
      effects: [
        {
          path: "/parentaccountid",
          name: "Parent account ID",
          raw_name: "parentaccountid",
          effect: "set",
          values: [{ text: "Example Holding", machine_id: true }],
          link: true,
        },
        {
          path: "/ownerid",
          name: "Owner ID",
          raw_name: "ownerid",
          effect: "set",
          values: [{ text: "", machine_id: true }],
          link: true,
        },
      ],
      counts: { set: 2 },
    });
    const [parent, owner] = screen.getAllByTestId("tool-call-change-row");
    expect(parent).toHaveTextContent(/^Parent accountlink to Example Holding$/);
    // No name is known, so the row still says it is an ID.
    expect(owner).toHaveTextContent(/^Owner ID/);
  });

  it("puts links and coded values first, and long text last", () => {
    renderAs(
      {
        effects: [
          set(1),
          {
            ...set(2),
            name: "Parent account ID",
            values: [{ text: "Example Holding", machine_id: true }],
            link: true,
          },
        ],
        counts: { set: 2 },
        texts: [
          {
            path: "/d",
            name: "Description",
            raw_name: "description",
            text: "Card check test record",
            lines: 1,
            chars: 22,
          },
        ],
      },
      { action: "create" },
    );
    const rows = screen.getAllByTestId("tool-call-change-row");
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual([
      "Parent account",
      "Field 1",
      "Description",
    ]);
  });

  it("keeps a real value in view ahead of a link that names no record", () => {
    renderAs(
      {
        effects: [
          {
            path: "/parentaccountid",
            name: "Parent account ID",
            raw_name: "parentaccountid",
            effect: "set",
            values: [{ text: "", machine_id: true }],
            link: true,
          },
          ...Array.from({ length: 7 }, (_, index) => set(index)),
        ],
        counts: { set: 8 },
      },
      { action: "create" },
    );
    const rows = screen.getAllByTestId("tool-call-change-row");
    expect(rows.map((row) => row.firstChild?.textContent)).toEqual([
      "Field 0",
      "Field 1",
      "Field 2",
      "Field 3",
      "Field 4",
    ]);
    expect(
      screen.getByRole("button", { name: /See 3 more fields/ }),
    ).toHaveTextContent(/· Field 5, Field 6, Parent account ID$/);
  });

  it("names every field behind See more up to ten", () => {
    renderAs({
      effects: [
        {
          path: "/stage",
          name: "Stage",
          raw_name: "stage",
          effect: "changed",
          values: [{ text: "customer" }],
          old: { text: "lead" },
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          ...set(index),
          effect: "unchanged",
        })),
      ],
      counts: { changed: 1, unchanged: 10 },
    });
    const seeMore = screen.getByRole("button", {
      name: /See 10 unchanged fields/,
    });
    expect(seeMore).toHaveTextContent(
      /· Field 0, Field 1, Field 2, Field 3, Field 4, Field 5, Field 6, Field 7, Field 8, Field 9$/,
    );
  });

  it("shows the values of a call that changes nothing, since they are all it holds", () => {
    renderAs({
      effects: [
        {
          path: "/title",
          name: "Title",
          raw_name: "title",
          effect: "unchanged",
          values: [{ text: "Upload fails" }],
        },
        {
          path: "/state",
          name: "State",
          raw_name: "state",
          effect: "unchanged",
          values: [{ text: "open" }],
        },
      ],
      counts: { unchanged: 2 },
      notes: ["nothing_changes"],
    });
    expect(screen.getByTestId("tool-call-change-qualifier")).toHaveTextContent(
      /nothing seems to change/,
    );
    const rows = within(screen.getByTestId("tool-call-gist-scroll"))
      .getAllByTestId("tool-call-change-row")
      .map((row) => row.textContent);
    expect(rows).toEqual(["TitleUpload fails", "Stateopen"]);
    expect(screen.queryByTestId("tool-call-change-see-more")).toBeNull();
  });

  it("reads an instruction as quoted content, with what Erato does not ask under it in words true of any tool", () => {
    renderAs(
      {
        effects: [],
        counts: {},
        opaque: [
          {
            kind: "instruction",
            path: "/task",
            text: "Click the Publish button and confirm the dialog",
            lines: 1,
          },
        ],
        notes: ["instruction_outcome_unknown"],
      },
      { action: "run" },
    );
    const statement = screen.getByTestId("tool-call-change-statement");
    expect(statement).toHaveClass("border-l-2");
    expect(statement).not.toHaveClass("font-mono");
    expect(statement.querySelector("blockquote")).toHaveTextContent(
      "Click the Publish button and confirm the dialog",
    );
    const opaque = screen.getByTestId("tool-call-change-opaque");
    expect(opaque).toHaveTextContent(
      "Erato does not ask you about the steps the tool takes with this text and cannot tell what will change.",
    );
    // The note fires on any instruction-like member, such as an image tool's
    // prompt, so it names no other assistant.
    expect(opaque).not.toHaveTextContent(/assistant/i);
    expect(screen.queryByTestId("tool-call-change-notes")).toBeNull();
  });

  it("says under the statement that the row count is unknown", () => {
    renderAs(
      {
        effects: [],
        counts: {},
        opaque: [
          {
            kind: "sql",
            path: "/q",
            text: "DELETE FROM log",
            lines: 1,
            found: ["DELETE"],
          },
        ],
        notes: ["row_count_unknown", "marked_destructive"],
      },
      { action: "run" },
    );
    const opaque = screen.getByTestId("tool-call-change-opaque");
    const found = within(opaque).getByTestId("tool-call-change-found");
    const note = within(opaque).getByTestId("tool-call-change-row-note");
    expect(note).toHaveTextContent(
      "Erato cannot tell how many rows this touches.",
    );
    expect(follows(found, note)).toBe(true);
    expect(document.body.textContent).not.toContain("destructive");
  });
});
