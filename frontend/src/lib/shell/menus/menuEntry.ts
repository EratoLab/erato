import type {
  ConfirmParams,
  ShellMenuIcon,
  ShellMenuItem,
} from "@/lib/shell/contract/systemMenus";

/** The page's own icons a menu entry can name; each drawing resolves them. */
export type MenuIconName =
  | "pin"
  | "unpin"
  | "share"
  | "rename"
  | "archive"
  | "unarchive"
  | "settings"
  | "signOut"
  | "uploadComputer"
  | "uploadCloud"
  /** What a tool without an icon of its own is drawn with. */
  | "tool";

export type MenuIcon =
  | { name: MenuIconName }
  /** An id `ResolvedIcon` understands: a facet's or a model's icon. */
  | { iconId: string };

/** Asked before the entry takes effect, in the web menu and the app's alike. */
export interface MenuConfirm {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * One entry of a menu as data: what the web menu and the system menu both
 * draw. The wire's fields, with icons named instead of drawn and the
 * confirmation the page asks before the pick takes effect.
 */
export interface MenuEntry extends Omit<ShellMenuItem, "icon" | "children"> {
  icon?: MenuIcon;
  children?: MenuEntry[];
  confirm?: MenuConfirm;
}

/**
 * What a builder returns: the entries, or `null` when this menu stays web
 * (a customer kit draws part of it, which a system menu cannot show).
 */
export type MenuDescription = MenuEntry[] | null;

export const iconKey = (icon: MenuIcon): string =>
  // eslint-disable-next-line lingui/no-unlocalized-strings -- a map key
  "name" in icon ? `name:${icon.name}` : `iconId:${icon.iconId}`;

/** Every distinct icon the entries name, for drawing them once each. */
export function menuIcons(entries: readonly MenuEntry[]): MenuIcon[] {
  const icons = new Map<string, MenuIcon>();
  const visit = (entry: MenuEntry) => {
    if (entry.icon) icons.set(iconKey(entry.icon), entry.icon);
    entry.children?.forEach(visit);
  };
  entries.forEach(visit);
  return [...icons.values()];
}

/**
 * The wire's items. An icon without a drawing is left out rather than sent
 * empty, so a failed drawing costs the picture, not the menu.
 */
export function toShellMenuItems(
  entries: readonly MenuEntry[],
  drawIcon: (icon: MenuIcon) => ShellMenuIcon | undefined,
): ShellMenuItem[] {
  return entries.map(({ icon, children, confirm: _confirm, ...rest }) => {
    const item: ShellMenuItem = { ...rest };
    const drawn = icon ? drawIcon(icon) : undefined;
    if (drawn) item.icon = drawn;
    if (children) item.children = toShellMenuItems(children, drawIcon);
    return item;
  });
}

export function findMenuEntry(
  entries: readonly MenuEntry[],
  id: string,
): MenuEntry | undefined {
  for (const entry of entries) {
    if (entry.id === id) return entry;
    const found = entry.children && findMenuEntry(entry.children, id);
    if (found) return found;
  }
  return undefined;
}

/** The action sheet the app shows for an entry's confirmation. */
export function confirmParams(
  confirm: MenuConfirm,
  confirmActionId: string,
): ConfirmParams {
  return {
    title: confirm.title,
    ...(confirm.message ? { message: confirm.message } : {}),
    cancelLabel: confirm.cancelLabel,
    actions: [{ id: confirmActionId, label: confirm.confirmLabel }],
  };
}
