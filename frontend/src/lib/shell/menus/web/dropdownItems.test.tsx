import { describe, expect, it, vi } from "vitest";

import { menuEntryDropdownItems } from "./dropdownItems";

describe("menuEntryDropdownItems", () => {
  it("draws sections as runs, reasons as descriptions, confirmations as dialogs", () => {
    const archive = vi.fn();
    const items = menuEntryDropdownItems(
      [
        { id: "first", label: "First", subtitle: "Now" },
        {
          id: "tools",
          inline: true,
          label: "Tools",
          children: [
            {
              id: "web",
              label: "Web",
              state: "on",
              keepOpen: true,
              disabled: true,
              disabledReason: "Locked",
            },
          ],
        },
        {
          id: "end",
          inline: true,
          children: [
            {
              id: "archive",
              label: "Archive",
              confirm: {
                title: "Archive?",
                message: "Still running.",
                confirmLabel: "Confirm",
                cancelLabel: "Cancel",
              },
            },
          ],
        },
      ],
      {
        onSelect: { first: vi.fn(), web: vi.fn(), archive },
        testIds: { archive: "archive-row" },
      },
    );

    expect(
      items.map((item) => [item.id, item.sectionHeader, item.separatorBefore]),
    ).toEqual([
      ["first", undefined, undefined],
      ["web", "Tools", undefined],
      ["archive", undefined, true],
    ]);
    expect(items[0].description).toBe("Now");
    expect(items[1]).toMatchObject({
      checked: true,
      keepOpenOnSelect: true,
      disabled: true,
      description: "Locked",
    });
    expect(items[2]).toMatchObject({
      testId: "archive-row",
      confirmAction: true,
      confirmTitle: "Archive?",
      confirmMessage: "Still running.",
      confirmButtonText: "Confirm",
      confirmCancelButtonText: "Cancel",
    });
    items[2].onClick();
    expect(archive).toHaveBeenCalledOnce();
  });

  it("leaves out an entry nothing handles", () => {
    const items = menuEntryDropdownItems(
      [
        { id: "settings", label: "Settings" },
        { id: "signOut", label: "Sign out" },
      ],
      { onSelect: { settings: vi.fn() } },
    );
    expect(items.map((item) => item.id)).toEqual(["settings"]);
  });

  it("refuses a sub-menu, which DropdownMenu cannot draw", () => {
    expect(() =>
      menuEntryDropdownItems(
        [{ id: "more", label: "More", children: [{ id: "a", label: "A" }] }],
        { onSelect: {} },
      ),
    ).toThrow(/sub-menu/);
  });
});
