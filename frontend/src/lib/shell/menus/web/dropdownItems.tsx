import { MenuIconView } from "./MenuIconView";

import type { DropdownMenuItem } from "@/components/ui/Controls/DropdownMenu";
import type { MenuEntry } from "@/lib/shell/menus/menuEntry";

interface MenuEntryDropdownOptions {
  /** What a pick of each entry does, by id; an entry without one is left out. */
  onSelect: Readonly<Record<string, (() => void) | undefined>>;
  testIds?: Readonly<Record<string, string | undefined>>;
}

/**
 * The web drawing of a flat description for `DropdownMenu`: entries, and
 * inline sections as runs with a header or a divider. `DropdownMenu` has no
 * sub-menus, so a description with one is drawn by its own menu instead.
 */
export function menuEntryDropdownItems(
  entries: readonly MenuEntry[],
  { onSelect, testIds = {} }: MenuEntryDropdownOptions,
): DropdownMenuItem[] {
  const items: DropdownMenuItem[] = [];
  const pushEntry = (entry: MenuEntry, opensSection?: { header?: string }) => {
    if (entry.children) {
      if (!entry.inline) {
        throw new Error(
          `menuEntryDropdownItems: "${entry.id}" is a sub-menu, which DropdownMenu does not draw`,
        );
      }
      entry.children.forEach((child, index) =>
        pushEntry(child, index === 0 ? { header: entry.label } : undefined),
      );
      return;
    }
    const onClick = onSelect[entry.id];
    if (!onClick) return;
    const description =
      entry.disabled && entry.disabledReason
        ? entry.disabledReason
        : entry.subtitle;
    const confirm = entry.confirm;
    items.push({
      id: entry.id,
      label: entry.label,
      icon: entry.icon ? <MenuIconView icon={entry.icon} /> : undefined,
      onClick,
      ...(entry.disabled ? { disabled: true } : {}),
      ...(entry.state === "on" ? { checked: true } : {}),
      ...(entry.keepOpen ? { keepOpenOnSelect: true } : {}),
      ...(description ? { description } : {}),
      ...(testIds[entry.id] ? { testId: testIds[entry.id] } : {}),
      ...(confirm
        ? {
            confirmAction: true,
            confirmTitle: confirm.title,
            confirmMessage: confirm.message,
            confirmButtonText: confirm.confirmLabel,
            confirmCancelButtonText: confirm.cancelLabel,
          }
        : {}),
      ...(opensSection
        ? opensSection.header
          ? { sectionHeader: opensSection.header }
          : { separatorBefore: true }
        : {}),
    });
  };
  entries.forEach((entry) => pushEntry(entry));
  return items;
}
