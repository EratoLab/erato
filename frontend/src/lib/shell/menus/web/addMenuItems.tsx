import { ADD_MENU_SECTION } from "@/lib/shell/menus/describeAddMenu";

import { MenuIconView } from "./MenuIconView";

import type {
  AddMenuActionItem,
  AddMenuSection,
  AddMenuSectionItem,
  AddMenuToolItem,
} from "@/components/ui/Chat/ChatInputAddMenu";
import type { MenuEntry } from "@/lib/shell/menus/menuEntry";
import type React from "react";

export interface AddMenuItems {
  fileSources: AddMenuActionItem[];
  tools: AddMenuToolItem[];
  extraSections: AddMenuSection[];
}

export interface AddMenuItemsOptions {
  /** A pick of an entry that closes the menu. */
  choose: (itemId: string) => void;
  /** A keep-open entry flipped; `on` is what the person asked for. */
  toggle: (itemId: string, on: boolean) => void;
  /**
   * The web's own drawing of an entry, icon included, where it shows more
   * than the entry's label and icon; undefined draws those.
   */
  draw?: (entry: MenuEntry) => React.ReactNode;
  /** The row's id in the web menu, which its test id and key carry. */
  webId?: (entry: MenuEntry) => string;
}

const shownSubtitle = (entry: MenuEntry) =>
  entry.disabled && entry.disabledReason
    ? entry.disabledReason
    : entry.subtitle;

/**
 * The web drawing of the "+" description for `ChatInputAddMenu`: the upload
 * and tool sections as its own groups, every other section below the tools,
 * and a sub-menu as a section opened as a page of the menu.
 */
export function addMenuItems(
  entries: readonly MenuEntry[],
  {
    choose,
    toggle,
    draw = () => undefined,
    webId = (entry) => entry.id,
  }: AddMenuItemsOptions,
): AddMenuItems {
  const common = (entry: MenuEntry) => {
    const drawn = draw(entry);
    return {
      id: webId(entry),
      label: drawn ?? entry.label,
      icon:
        drawn === undefined && entry.icon ? (
          <MenuIconView icon={entry.icon} />
        ) : undefined,
      ...(entry.disabled ? { disabled: true } : {}),
    };
  };
  const action = (entry: MenuEntry): AddMenuActionItem => ({
    ...common(entry),
    description: shownSubtitle(entry),
    ...(entry.web?.closesImmediately ? { closesImmediately: true } : {}),
    ...(entry.web?.twoLineSubtitle ? { truncateDescription: true } : {}),
    onSelect: () => choose(entry.id),
  });
  const ticked = (entry: MenuEntry, exclusive: boolean): AddMenuToolItem => {
    const checked = entry.state === "on";
    return {
      ...common(entry),
      checked,
      description: shownSubtitle(entry),
      ...(exclusive ? { exclusive: true } : {}),
      onToggle: () =>
        entry.keepOpen ? toggle(entry.id, !checked) : choose(entry.id),
    };
  };
  const row = (entry: MenuEntry, parent: MenuEntry): AddMenuSectionItem =>
    entry.state
      ? ticked(entry, parent.selection === "single" && !entry.keepOpen)
      : action(entry);
  const section = (entry: MenuEntry): AddMenuSection => {
    const children = entry.children ?? [];
    const [only] = children;
    // A section holding one sub-menu opens it as a page of the menu.
    if (children.length === 1 && only.children && !only.inline) {
      return {
        id: only.id,
        header: only.label,
        // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
        placement: "belowTools",
        submenu: { summary: only.subtitle },
        items: only.children.map((child) => row(child, only)),
      };
    }
    return {
      id: entry.id,
      header: entry.label,
      // eslint-disable-next-line lingui/no-unlocalized-strings -- AddMenuSection placement enum
      placement: "belowTools",
      items: children.map((child) => row(child, entry)),
    };
  };

  const items: AddMenuItems = { fileSources: [], tools: [], extraSections: [] };
  for (const entry of entries) {
    const children = entry.children ?? [];
    if (entry.id === ADD_MENU_SECTION.uploads) {
      items.fileSources = children.map(action);
    } else if (entry.id === ADD_MENU_SECTION.tools) {
      items.tools = children.map((child) => ticked(child, false));
    } else {
      items.extraSections.push(section(entry));
    }
  }
  return items;
}
