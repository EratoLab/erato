import { expect, userEvent, within } from "@storybook/test";

import { Row, ROW_ITEM_SELECTOR } from "../../components/ui/Controls/Row";

import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Row/Tests",
  component: Row,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Row>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A popover panel, so the rows resolve the same channels they do in the app. */
const MenuPanel = ({ children }: { children: React.ReactNode }) => (
  <div
    className="anchored-popover-skin dropdown-panel-chrome-geometry w-64 border"
    role="menu"
  >
    {children}
  </div>
);

/**
 * The keyboard-active row paints the hover surface and draws a ring, and it does
 * so on `:focus` — a pointer click, which never matches `:focus-visible`, is
 * enough to light it. The unit test pins the utility strings; this one pins that
 * they still resolve to paint against the real stylesheet.
 */
export const MenuRowFocusRecipe: Story = {
  args: { variant: "menu" },
  render: () => (
    <div className="flex flex-col gap-4">
      <span
        data-testid="hover-reference"
        className="block size-4 bg-theme-bg-hover"
      />
      <MenuPanel>
        <Row variant="menu" role="menuitem">
          Rename
        </Row>
      </MenuPanel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reference = canvas.getByTestId("hover-reference");
    const row = canvas.getByRole("menuitem", { name: "Rename" });

    await expect(window.getComputedStyle(row).backgroundColor).not.toBe(
      window.getComputedStyle(reference).backgroundColor,
    );

    await userEvent.click(row);

    await expect(row).toHaveFocus();
    await expect(window.getComputedStyle(row).backgroundColor).toBe(
      window.getComputedStyle(reference).backgroundColor,
    );
    await expect(window.getComputedStyle(row).boxShadow).not.toBe("none");
    await expect(window.getComputedStyle(row).outlineStyle).toBe("none");
  },
};

/**
 * An open submenu row stays lit while its flyout is up. The pair that does it
 * lives in Row's menu variant unconditionally, which is what retires the
 * hand-written specificity workaround the filter menu used to carry.
 */
export const ExpandedMenuRowStaysLit: Story = {
  args: { variant: "menu" },
  render: () => (
    <div className="flex flex-col gap-4">
      <span
        data-testid="hover-reference"
        className="block size-4 bg-theme-bg-hover"
      />
      <MenuPanel>
        <Row
          variant="menu"
          role="menuitem"
          expanded
          aria-haspopup="menu"
          data-testid="expanded-row"
        >
          Sort by
        </Row>
        <Row
          variant="menu"
          role="menuitem"
          expanded={false}
          aria-haspopup="menu"
          data-testid="collapsed-row"
        >
          Filter by
        </Row>
      </MenuPanel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const hover = window.getComputedStyle(
      canvas.getByTestId("hover-reference"),
    ).backgroundColor;

    await expect(
      window.getComputedStyle(canvas.getByTestId("expanded-row"))
        .backgroundColor,
    ).toBe(hover);
    await expect(
      window.getComputedStyle(canvas.getByTestId("collapsed-row"))
        .backgroundColor,
    ).not.toBe(hover);
  },
};

/**
 * The roving list. A natively disabled row drops out; an `aria-disabled` one
 * stays in, which is the whole reason `disabledMode` exists — the add menu's
 * unavailable tool rows have to stay reachable to explain themselves.
 */
export const RovingMarkerSkipsNativeDisabledOnly: Story = {
  args: { variant: "menu" },
  render: () => (
    <MenuPanel>
      <Row variant="menu" role="menuitem">
        First
      </Row>
      <Row variant="menu" role="menuitem" disabled>
        Native disabled
      </Row>
      <Row variant="menu" role="menuitem" disabled disabledMode="aria">
        Aria disabled
      </Row>
      <Row variant="menu" role="menuitem">
        Last
      </Row>
    </MenuPanel>
  ),
  play: async ({ canvasElement }) => {
    const rows = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(ROW_ITEM_SELECTOR),
    );

    await expect(rows.map((row) => row.textContent)).toEqual([
      "First",
      "Aria disabled",
      "Last",
    ]);
  },
};

/**
 * The selected sidebar row paints the shell's selected surface from a class, so
 * a customer theme can retune it. An inline style — which three hand-rolled row
 * copies used — is unreachable at any specificity.
 */
export const SelectedSidebarRowPaintsFromAClass: Story = {
  args: { variant: "sidebar" },
  render: () => (
    <div
      className="flex w-72 flex-col gap-1 p-2"
      style={{ backgroundColor: "var(--theme-shell-sidebar)" }}
    >
      <span
        data-testid="selected-reference"
        className="block size-4"
        style={{ backgroundColor: "var(--theme-shell-sidebar-selected)" }}
      />
      <Row
        variant="sidebar"
        as="div"
        selected
        className="items-center gap-3 px-3"
        data-testid="selected-row"
      >
        Today&apos;s chat
      </Row>
      <Row
        variant="sidebar"
        as="div"
        className="items-center gap-3 px-3"
        data-testid="idle-row"
      >
        Yesterday&apos;s chat
      </Row>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selectedSurface = window.getComputedStyle(
      canvas.getByTestId("selected-reference"),
    ).backgroundColor;
    const selectedRow = canvas.getByTestId("selected-row");

    await expect(window.getComputedStyle(selectedRow).backgroundColor).toBe(
      selectedSurface,
    );
    await expect(selectedRow).not.toHaveAttribute("style");
    await expect(
      window.getComputedStyle(canvas.getByTestId("idle-row")).backgroundColor,
    ).not.toBe(selectedSurface);
  },
};
