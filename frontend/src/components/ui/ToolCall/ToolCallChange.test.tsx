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

const renderCard = (raw: object) => {
  const change = readAs(raw);
  return render(
    <I18nProvider i18n={i18n}>
      <ToolCallChangeCard gist={gistFor(change)} change={change} phase="ask" />
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
    // Names are capped and the rest are counted, never silently clipped.
    expect(screen.getByTestId("tool-call-change-names")).toHaveTextContent(
      "+17 more",
    );
    expect(screen.queryByText("ppt_field_6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /See 25 more fields/ }));
    expect(screen.getByText("ppt_field_6")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-change-names")).toBeNull();
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
    expect(
      screen.getByText("The list Labels is replaced: 2 go, 1 stays"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("tool-call-change-list")).toHaveTextContent(
      "p1, backend",
    );
    const notes = screen.getByTestId("tool-call-change-notes");
    expect(notes).toHaveTextContent(
      "The tool says it replaces the current list.",
    );
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
    expect(part).toHaveTextContent("To 40 addresses (32 To, 8 Cc)");
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
    expect(details).toHaveTextContent("Stage lead → customer");
    expect(details).toHaveTextContent("+1");
    expect(details.textContent).not.toContain(UUID);
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
  it("says who marked a tool as destructive", () => {
    renderCard({
      effects: [],
      counts: {},
      notes: ["operator_marked_destructive"],
    });
    expect(
      screen.getByText(
        "Your organisation has marked this tool as destructive.",
      ),
    ).toBeInTheDocument();
  });

    expect(box).toHaveAccessibleName("Scrollable details of this call");
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });
});
