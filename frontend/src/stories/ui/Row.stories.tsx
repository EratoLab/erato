import { Row } from "../../components/ui/Controls/Row";
import {
  CheckIcon,
  ChevronRightIcon,
  EditIcon,
  Trash,
} from "../../components/ui/icons";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Row",
  component: Row,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
One row, for the two families that have one: the rows inside a popover menu and the rows in the
sidebar. Every kebab menu item, "+" menu row, filter row, nav row and chat-history row is this
component, so a customer theme reaches all of them through the geometry class the variant emits and
the \`data-ui\` hook it carries.

\`\`\`css
[data-ui="menu-item"] { … }          /* every actionable menu row */
.dropdown-item-geometry { … }        /* the menu row's padding and radius */
.sidebar-row-geometry { … }          /* the sidebar row's height and radius */
.sidebar-row-selected { … }          /* the selected sidebar surface */
\`\`\`

## What Row owns, and what the site keeps

Row emits the geometry class, the state attributes and the family's hover and focus recipe. The
site keeps its own flow, because the two families disagree about it: the history row is a column
(\`flex-col gap-1\`), the nav row a centred line (\`items-center gap-3\`). The \`sidebar\` variant
therefore emits \`flex\` and **nothing on the cross axis**, and \`className\` is documented as
layout-only — there is no \`tailwind-merge\` here, so a utility that collides with the variant's
own classes does not replace it. The corner radius in particular has to stay in the geometry class.

Row never writes an inline \`style\`. Three hand-rolled row copies did, and an inline height or
radius is unreachable from a theme at any specificity.

## Two focus recipes, deliberately not unified

\`menu\` carries the ERMAIN-467 recipe: a soft highlight with a faint 1px inset border, keyed to
\`:focus\` rather than \`:focus-visible\`, so an arrowed-to row reads as *active* and not as the old
heavy *pre-selected* ring. \`sidebar\` uses \`.focus-ring-inset\`, and only where the row itself is
the focusable element — in the linked branches the surrounding \`<a>\` carries the ring.

## State

\`selected\` emits \`data-selected\` as a presence attribute (never \`="false"\`), \`current\` emits
\`aria-current="page"\`, \`expanded\` emits \`aria-expanded\` and \`checked\` emits \`aria-checked\`
— tri-state, so \`false\` is emitted too. \`role\` is passed through verbatim and never forced:
a \`menuitemcheckbox\` stays one.

\`disabledMode="aria"\` announces a row as unavailable while keeping it in the tab order and in
\`ROW_ITEM_SELECTOR\`, so the row can still explain itself. \`native\` takes it out of both.
        `,
      },
    },
  },
  argTypes: {
    variant: { control: "radio", options: ["menu", "sidebar"] },
    as: { control: "radio", options: ["button", "div", "a", "label"] },
    align: { control: "radio", options: ["center", "start"] },
    tone: {
      control: "select",
      options: [
        "neutral",
        "muted",
        "accent",
        "info",
        "success",
        "warning",
        "error",
      ],
    },
    disabledMode: { control: "radio", options: ["native", "aria"] },
    interactive: { control: "boolean" },
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Row>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A popover panel, so the menu rows sit on the surface they were shaped for. */
const MenuPanel = ({ children }: { children: React.ReactNode }) => (
  <div
    className="anchored-popover-skin dropdown-panel-chrome-geometry w-64 border"
    role="menu"
  >
    {children}
  </div>
);

/** The sidebar shell, which supplies the row inset and the surface behind it. */
const SidebarShell = ({ children }: { children: React.ReactNode }) => (
  <div
    className="w-72 space-y-1 p-2"
    style={{ backgroundColor: "var(--theme-shell-sidebar)" }}
  >
    {children}
  </div>
);

export const Default: Story = {
  args: {
    variant: "menu",
    role: "menuitem",
    children: "Rename",
  },
  render: (args) => (
    <MenuPanel>
      <Row {...args} />
    </MenuPanel>
  ),
};

/**
 * Every shape the menu family needs. Hover a row for the tint, tab into one for
 * the keyboard-active border, and note that the `aria-disabled` row still takes
 * focus while the natively disabled one does not.
 */
export const MenuRows: Story = {
  args: { variant: "menu" },
  render: () => (
    <MenuPanel>
      <Row variant="menu" role="menuitem" leading={<EditIcon />}>
        Rename
      </Row>
      <Row
        variant="menu"
        role="menuitem"
        leading={<Trash />}
        tone="error"
        trailing={<span className="text-xs text-theme-fg-muted">⌫</span>}
      >
        Delete
      </Row>
      <Row
        variant="menu"
        role="menuitemcheckbox"
        checked
        trailing={<CheckIcon className="size-4" />}
      >
        Web search
      </Row>
      <Row
        variant="menu"
        role="menuitem"
        expanded
        aria-haspopup="menu"
        trailing={<ChevronRightIcon className="size-4" />}
      >
        Sort by
      </Row>
      <Row variant="menu" role="menuitem" disabled>
        Pin (native disabled)
      </Row>
      <Row
        variant="menu"
        role="menuitem"
        disabled
        disabledMode="aria"
        description="Attachments are still uploading"
      >
        Add file
      </Row>
    </MenuPanel>
  ),
};

/**
 * The add-in's injected rows: a two-line body under `align="start"`, with the
 * size pushed to the end by the `trailing` slot's own margin rather than by a
 * `justify-between` on the row, which would fight the row's gap.
 */
export const MenuRowsStartAligned: Story = {
  name: "Menu rows, start aligned",
  args: { variant: "menu" },
  render: () => (
    <MenuPanel>
      <Row
        variant="menu"
        role="menuitem"
        align="start"
        description="Q3 planning — 14 messages.eml"
        trailing={<span className="text-xs text-theme-fg-muted">128 KB</span>}
      >
        Email thread
      </Row>
      <Row
        variant="menu"
        role="menuitem"
        align="start"
        description="budget-2026.xlsx"
        trailing={<span className="text-xs text-theme-fg-muted">42 KB</span>}
      >
        Attachment
      </Row>
    </MenuPanel>
  ),
};

/**
 * `interactive={false}` drops the hover tint, the focus recipe, `cursor-pointer`
 * and `theme-transition`, leaving the item geometry and a tone colour. It is
 * what a status line inside a menu needs; without it the line would light up
 * under the pointer as though it could be chosen. It also drops the roving
 * marker and the `menu-item` hook, so an arrow-key walk steps over the line
 * rather than stalling on an element that cannot take focus.
 */
export const MenuInfoRows: Story = {
  name: "Menu info rows",
  args: { variant: "menu" },
  render: () => (
    <MenuPanel>
      <Row variant="menu" as="div" interactive={false} tone="muted">
        <span className="text-xs">Loading email thread…</span>
      </Row>
      <Row variant="menu" as="div" interactive={false} tone="error">
        <span className="text-xs">
          Couldn&apos;t load this conversation from the server.
        </span>
      </Row>
    </MenuPanel>
  ),
};

/**
 * The two sidebar shapes. The nav rows keep `items-center gap-3` and the history
 * row keeps `flex-col gap-1` — Row sets no cross axis, so both are the site's to
 * choose. Only the last row takes focus itself, so only it draws the inset ring.
 */
export const SidebarRows: Story = {
  args: { variant: "sidebar" },
  render: () => (
    <SidebarShell>
      <Row
        variant="sidebar"
        as="div"
        className="items-center gap-3 px-3"
        data-ui="sidebar-search-item"
      >
        <EditIcon className="size-4 shrink-0 text-theme-fg-secondary" />
        <span className="font-medium text-theme-fg-primary">Search</span>
      </Row>
      <Row
        variant="sidebar"
        as="div"
        selected
        current
        interactive={false}
        className="items-center gap-3 px-3"
        data-ui="sidebar-assistants-item"
      >
        <EditIcon className="size-4 shrink-0 text-theme-fg-secondary" />
        <span className="font-medium text-theme-fg-primary">Assistants</span>
      </Row>
      <Row
        variant="sidebar"
        as="div"
        className="flex-col gap-1 px-3 py-1.5"
        data-ui="chat-history-item"
      >
        <span className="truncate font-medium">Quarterly planning</span>
        <span className="truncate text-xs text-theme-fg-muted">
          Yesterday · 12 messages
        </span>
      </Row>
      <Row
        variant="sidebar"
        as="div"
        selected
        className="flex-col gap-1 px-3 py-1.5"
        data-ui="chat-history-item"
      >
        <span className="truncate font-medium">Draft the release note</span>
        <span className="truncate text-xs text-theme-fg-muted">
          Today · 4 messages
        </span>
      </Row>
      <Row
        variant="sidebar"
        as="div"
        onClick={() => undefined}
        className="items-center gap-3 px-3"
      >
        <EditIcon className="size-4 shrink-0 text-theme-fg-secondary" />
        <span className="font-medium text-theme-fg-primary">New Chat</span>
      </Row>
    </SidebarShell>
  ),
};

/**
 * One rule reaches every menu row on the page, because they all carry the same
 * family hook. A row that needs to stay out of a theme's reach passes its own
 * `data-ui` instead — that is how the history row keeps its private padding
 * rule while sharing the sidebar geometry class.
 */
export const Retuned: Story = {
  args: { variant: "menu" },
  render: () => (
    <div className="flex flex-col gap-6">
      <style>{`
        [data-ui="menu-item"] {
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
      `}</style>
      <MenuPanel>
        <Row variant="menu" role="menuitem" leading={<EditIcon />}>
          Rename
        </Row>
        <Row variant="menu" role="menuitem" leading={<Trash />} tone="error">
          Delete
        </Row>
        <Row variant="menu" role="menuitem" data-ui="run-mode-item">
          Left out of the rule
        </Row>
      </MenuPanel>
    </div>
  ),
};
