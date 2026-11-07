import { userEvent } from "@storybook/test";
import { useState } from "react";

import { SelectableRow } from "../../components/ui/Controls/SelectableRow";
import { SpinnerIcon } from "../../components/ui/Feedback/SpinnerIcon";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  PageIcon,
  WarningIcon,
} from "../../components/ui/icons";

import type { SelectableRowLayout } from "../../components/ui/Controls/SelectableRow";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/SelectableRow",
  component: SelectableRow,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
A row that frames a checkbox. The checkbox owns selection and Space, and the
title owns drill-in: with \`onOpen\` the title is a button outside the tab order
(for the pointer and screen-reader browse mode), and a click anywhere else on
the row opens too and moves focus to the checkbox. A list of these rows is one
tab stop when the caller roves \`tabIndex\` over
\`SELECTABLE_ROW_CHECKBOX_SELECTOR\`.

Tone follows selection in the skin, so a flagged row that is also selected keeps
its warning fill.

\`\`\`css
[data-ui="selectable-row"] { --selectable-row-bg: …; --selectable-row-meta: …; }
.selectable-row-geometry { … }   /* grid, height, padding, corner */
:root { --theme-selectable-row-selected-bg: …; }
\`\`\`
        `,
      },
    },
  },
  args: {
    selected: false,
    onSelectedChange: () => {},
    selectLabel: "",
    title: "",
  },
} satisfies Meta<typeof SelectableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

interface ReviewItem {
  id: string;
  kind: "email" | "attachment";
  title: string;
  meta: string;
  date: string;
}

// The five test-mailbox hits of the review window design.
const ITEMS: ReviewItem[] = [
  {
    id: "0.0",
    kind: "email",
    title: "Test with attachment",
    meta: "Max Goisser <max@eratolabs.com>",
    date: "16.09.2026, 14:19",
  },
  {
    id: "0.1",
    kind: "email",
    title: "(Kein Betreff)",
    meta: "Max Goisser <max@eratolabs.com>",
    date: "29.10.2026, 14:31",
  },
  {
    id: "0.2",
    kind: "attachment",
    title: "multipage-test.pdf",
    meta: "Anhang · 34 KB",
    date: "16.09.2026, 14:19",
  },
  {
    id: "0.3",
    kind: "email",
    title: "Re: Teams transcript indexing",
    meta: "Jane Windows <windows1@ms.eratolabs.com>",
    date: "02.10.2026, 09:04",
  },
  {
    id: "0.4",
    kind: "attachment",
    title: "Budget_2026_draft.xlsx",
    meta: "Anhang · 118 KB",
    date: "02.10.2026, 09:04",
  },
];

type CheckStatus = "checking" | "checked" | "concern";

interface ReviewRowsProps {
  items?: ReviewItem[];
  initialSelected?: string[];
  current?: string;
  status?: Record<string, CheckStatus>;
  disabled?: boolean;
  layout?: SelectableRowLayout;
  width?: string;
}

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="pill-geometry whitespace-nowrap border border-theme-warning-border bg-theme-warning-bg px-1.5 text-xs text-theme-warning-fg">
    {children}
  </span>
);

const ReviewRows = ({
  items = ITEMS,
  initialSelected = [],
  current,
  status = {},
  disabled = false,
  layout = "columns",
  width = "60rem",
}: ReviewRowsProps) => {
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [open, setOpen] = useState(current);

  return (
    <ul
      aria-label="Treffer"
      className="max-w-full border-b border-theme-border"
      style={{ width }}
    >
      {items.map((item) => {
        const itemStatus = selected.has(item.id) ? status[item.id] : undefined;
        const concern = itemStatus === "concern";
        const isOpen = open === item.id;
        return (
          <SelectableRow
            key={item.id}
            selected={selected.has(item.id)}
            onSelectedChange={(next) =>
              setSelected((previous) => {
                const updated = new Set(previous);
                if (next) {
                  updated.add(item.id);
                } else {
                  updated.delete(item.id);
                }
                return updated;
              })
            }
            selectLabel={
              concern ? `${item.title}, Richtlinienbedenken` : item.title
            }
            disabled={disabled}
            icon={
              concern ? (
                <WarningIcon className="size-4" />
              ) : item.kind === "email" ? (
                <MailIcon className="size-4" />
              ) : (
                <PageIcon className="size-4" />
              )
            }
            title={item.title}
            titleEnd={concern ? <Badge>Richtlinienbedenken</Badge> : undefined}
            meta={
              itemStatus === "checking"
                ? `${item.meta} · wird geprüft …`
                : item.meta
            }
            end={item.date}
            trailing={
              itemStatus === "checking" ? (
                <SpinnerIcon size="sm" />
              ) : itemStatus === "checked" ? (
                <CheckIcon className="size-4" aria-label="geprüft" />
              ) : isOpen ? (
                <ChevronLeftIcon className="size-4" aria-hidden="true" />
              ) : (
                <ChevronRightIcon className="size-4" aria-hidden="true" />
              )
            }
            tone={concern ? "warning" : "neutral"}
            busy={itemStatus === "checking"}
            onOpen={() => setOpen(item.id)}
            openLabel={`Vorschau: ${item.title}`}
            current={isOpen}
            detailId="story-preview"
            layout={layout}
          />
        );
      })}
    </ul>
  );
};

/** Artboard 1: nothing selected, no preview. */
export const Default: Story = {
  render: () => <ReviewRows />,
};

/** Artboard 2: two rows selected, the first one open in the preview. */
export const Selected: Story = {
  render: () => <ReviewRows initialSelected={["0.0", "0.2"]} current="0.0" />,
};

/** Keyboard focus on the first row: the row draws the ring, not the checkbox. */
export const Focus: Story = {
  render: () => <ReviewRows initialSelected={["0.0"]} />,
  play: async () => {
    await userEvent.tab();
  },
};

/** Artboard 3: one row checked, one still being checked. */
export const Checking: Story = {
  render: () => (
    <ReviewRows
      initialSelected={["0.0", "0.2"]}
      status={{ "0.0": "checked", "0.2": "checking" }}
    />
  ),
};

/** Artboard 4: the selected attachment has a policy concern and is open. */
export const SelectedWithConcern: Story = {
  render: () => (
    <ReviewRows
      initialSelected={["0.0", "0.2"]}
      current="0.2"
      status={{ "0.0": "checked", "0.2": "concern" }}
    />
  ),
};

/** A flagged row on its own, selected and not, and an error row. */
export const Tones: Story = {
  render: () => (
    <ul className="max-w-full" style={{ width: "60rem" }}>
      <SelectableRow
        selected={false}
        onSelectedChange={() => {}}
        selectLabel="multipage-test.pdf, Richtlinienbedenken"
        icon={<WarningIcon className="size-4" />}
        title="multipage-test.pdf"
        titleEnd={<Badge>Richtlinienbedenken</Badge>}
        meta="Anhang · 34 KB"
        end="16.09.2026, 14:19"
        tone="warning"
      />
      <SelectableRow
        selected
        onSelectedChange={() => {}}
        selectLabel="multipage-test.pdf, Richtlinienbedenken"
        icon={<WarningIcon className="size-4" />}
        title="multipage-test.pdf"
        titleEnd={<Badge>Richtlinienbedenken</Badge>}
        meta="Anhang · 34 KB"
        end="16.09.2026, 14:19"
        tone="warning"
      />
      <SelectableRow
        selected
        onSelectedChange={() => {}}
        selectLabel="Budget_2026_draft.xlsx"
        icon={<PageIcon className="size-4" />}
        title="Budget_2026_draft.xlsx"
        meta="Anhang · 118 KB"
        end="02.10.2026, 09:04"
        tone="error"
      />
    </ul>
  ),
};

/** While sharing: every row is disabled. */
export const Disabled: Story = {
  render: () => <ReviewRows initialSelected={["0.0", "0.2"]} disabled />,
};

export const LongTitle: Story = {
  render: () => (
    <ReviewRows
      initialSelected={["0.2"]}
      status={{ "0.2": "concern" }}
      items={[
        {
          ...ITEMS[2],
          title:
            "Quartalsbericht_Vertrieb_Region_Sued_final_wirklich_final_v12_mit_Anmerkungen_der_Geschaeftsfuehrung.pdf",
        },
        {
          ...ITEMS[0],
          id: "0.5",
          title: "‏مرحبا بالعالم – Re: Test with attachment",
        },
      ]}
    />
  ),
};

/** Below 36rem the list stacks meta and date under the title. */
export const Stacked: Story = {
  render: () => (
    <ReviewRows
      layout="stacked"
      width="28rem"
      initialSelected={["0.0", "0.2"]}
      current="0.0"
      status={{ "0.0": "checked", "0.2": "concern" }}
    />
  ),
};

export const Dark: Story = {
  render: () => (
    <ReviewRows
      initialSelected={["0.0", "0.2"]}
      current="0.2"
      status={{ "0.0": "checked", "0.2": "concern" }}
    />
  ),
  globals: { theme: "dark" },
};
