import { ToolCallChangeCard } from "@/components/ui/ToolCall/ToolCallChange";
import { readChange } from "@/lib/toolCallGist/change";

import type { GistChange } from "@/lib/toolCallGist/change";
import type { Gist, GistAction, GistKind } from "@/lib/toolCallGist/gist";
import type { Meta, StoryObj } from "@storybook/react";

interface CardArgs {
  action: GistAction;
  kind: GistKind;
  name?: string;
  place?: string;
  count?: number;
  width: number;
  raw: object;
}

const Card = ({
  action,
  kind,
  name,
  place,
  count = 1,
  width,
  raw,
}: CardArgs) => {
  const change: GistChange | undefined = readChange({
    complete: true,
    counts: {},
    ...raw,
  });
  if (!change) return <p>No change description</p>;
  const gist: Gist = {
    action,
    kind,
    items: [
      {
        names: name
          ? [{ text: name, origin: "resolved", path: "", truncated: false }]
          : [],
        count,
        hiddenIdPaths: [],
        where: place
          ? [{ text: place, origin: "place", path: "", truncated: false }]
          : [],
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
  };
  return (
    <div
      style={{ width }}
      className="rounded-lg border border-theme-border p-3"
      data-testid="story-card"
    >
      <ToolCallChangeCard gist={gist} change={change} phase="ask" />
    </div>
  );
};

const meta = {
  title: "UI/ToolCall/ToolCallChangeCard",
  component: Card,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

const field = (name: string, value: string) => ({
  path: `/${name}`,
  name,
  raw_name: `ppt_${name.toLowerCase().replace(/ /g, "_")}`,
  effect: "set",
  values: [{ text: value }],
});

const changed = (name: string, before: string, after: string) => ({
  ...field(name, after),
  effect: "changed",
  old: { text: before },
});

const emptied = (name: string) => ({
  path: `/${name}`,
  name,
  raw_name: `ppt_${name.toLowerCase().replace(/ /g, "_")}`,
  effect: "emptied",
});

const manyFields = Array.from({ length: 22 }, (_, index) =>
  field(`Custom field ${index + 1}`, `value ${index + 1}`),
);

const update30: CardArgs = {
  action: "update",
  kind: "row",
  name: "Contoso Testanlage Retrofit",
  place: "Verkaufschance",
  width: 640,
  raw: {
    effects: [
      changed("Reach out timing", "1", "3"),
      emptied("Escalation owner"),
      changed("Renewal due on", "2026-06-30", "2026-12-31"),
      changed("Seat count", "120", "250"),
      emptied("Aux field 12"),
      changed("Discount pct", "5.0", "12.5"),
      changed("SLA tier", "silver", "gold"),
      emptied("Iban"),
      ...manyFields,
    ],
    counts: { emptied: 3, changed: 5, set: 22 },
    notes: ["old_values_from_earlier", "marked_destructive"],
  },
};

const listReplaced: CardArgs = {
  action: "update",
  kind: "task",
  name: "Upload fails for files over 2 GB",
  place: "contoso / uploader",
  width: 640,
  raw: {
    effects: [
      {
        path: "/labels",
        name: "Labels",
        raw_name: "labels",
        effect: "list_replaced",
        values: [{ text: "bug" }],
        removed: [
          { text: "p1" },
          { text: "backend" },
          { text: "needs-triage" },
          { text: "customer-reported" },
        ],
        kept: [{ text: "bug" }],
      },
    ],
    counts: { list_replaced: 1 },
    notes: ["tool_says_replaces_list", "old_values_from_earlier"],
  },
};

const send: CardArgs = {
  action: "send",
  kind: "email",
  name: "Reorganisation of the sales regions",
  width: 640,
  raw: {
    recipients: {
      total: 40,
      groups: [
        {
          name: "To",
          raw_name: "to",
          count: 32,
          values: Array.from(
            { length: 29 },
            (_, index) => `person${index}@contoso.example`,
          ).concat([
            "ana@fabrikam.example",
            "bert@northwind.example",
            "cleo@tailspin.example",
          ]),
        },
        {
          name: "Cc",
          raw_name: "cc",
          count: 8,
          values: Array.from(
            { length: 8 },
            (_, index) => `copy${index}@contoso.example`,
          ),
        },
      ],
      outside: [
        "ana@fabrikam.example",
        "bert@northwind.example",
        "cleo@tailspin.example",
      ],
      outside_known: true,
    },
    texts: [
      {
        path: "/body",
        name: "Body",
        raw_name: "body",
        text: "Dear colleagues,\n\nStarting in January the sales regions will change. Details follow in the attached slides.\n\nBest regards",
        lines: 5,
        chars: 118,
      },
    ],
  },
};

const sql: CardArgs = {
  action: "run",
  kind: "other",
  place: "prj1",
  width: 640,
  raw: {
    opaque: [
      {
        kind: "sql",
        name: "Query",
        raw_name: "query",
        path: "/query",
        text: "WITH gone AS (DELETE FROM audit_log\n  WHERE created_at < now() - interval '30 days'\n  RETURNING id)\nSELECT count(*) FROM gone;",
        lines: 4,
        found: ["DELETE"],
        write_inside_read: true,
      },
    ],
    notes: ["row_count_unknown"],
  },
};

const batch: CardArgs = {
  action: "upsert",
  kind: "row",
  place: "Product2",
  count: 500,
  width: 640,
  raw: {
    batch: {
      path: "/records",
      name: "Records",
      total: 500,
      same_change: false,
      rows: Array.from({ length: 50 }, (_, index) => ({
        number: index + 1,
        name: `SKU-${String(index).padStart(4, "0")}`,
        effects: [
          {
            path: "/n",
            name: "Name",
            raw_name: "Name",
            effect: "set",
            values: [{ text: `Widget ${index}` }],
          },
          {
            path: "/p",
            name: "List price",
            raw_name: "List_Price__c",
            effect: "set",
            values: [{ text: String(10 + index) }],
          },
        ],
      })),
      fields: [
        {
          name: "List price",
          raw_name: "List_Price__c",
          rows: 500,
          distinct: 200,
          samples: [{ text: "10" }, { text: "11" }, { text: "12" }],
        },
        {
          name: "Active",
          raw_name: "IsActive",
          rows: 500,
          distinct: 2,
          samples: [{ text: "true" }, { text: "false" }],
        },
        {
          name: "Discontinued on",
          raw_name: "Discontinued_On__c",
          rows: 500,
          emptied: 7,
          distinct: 1,
          samples: [{ text: "2026-12-31" }],
        },
      ],
      rows_emptying: 7,
      read_all: true,
    },
    notes: [],
  },
};

const deletion: CardArgs = {
  action: "delete",
  kind: "folder",
  name: "Namespace shop",
  width: 640,
  raw: {
    flags: [
      { name: "Recursive", raw_name: "recursive", path: "/recursive" },
      { name: "Force", raw_name: "force", path: "/force" },
    ],
    notes: ["marked_destructive", "delete_outcome_unknown"],
  },
};

const pane = (args: CardArgs): CardArgs => ({ ...args, width: 360 });

export const Update30Fields: Story = { args: update30 };
export const Update30FieldsPane: Story = { args: pane(update30) };
export const ReplacedList: Story = { args: listReplaced };
export const ReplacedListPane: Story = { args: pane(listReplaced) };
export const SendWithOutsiders: Story = { args: send };
export const SendWithOutsidersPane: Story = { args: pane(send) };
export const Sql: Story = { args: sql };
export const SqlPane: Story = { args: pane(sql) };
export const Batch: Story = { args: batch };
export const BatchPane: Story = { args: pane(batch) };
export const Delete: Story = { args: deletion };
export const DeletePane: Story = { args: pane(deletion) };
