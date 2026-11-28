import { Cloud, Computer } from "iconoir-react";

import {
  ArchiveIcon,
  EditIcon,
  LogOutIcon,
  PinIcon,
  PinSlashIcon,
  SettingsIcon,
  ShareIcon,
  UndoIcon,
} from "@/components/ui/icons";
import { ResolvedIcon } from "@/components/ui/icons/ResolvedIcon";

import type { MenuIcon, MenuIconName } from "@/lib/shell/menus/menuEntry";
import type React from "react";

const NAMED_MENU_ICONS: Record<
  MenuIconName,
  (props: { className?: string }) => React.ReactNode
> = {
  pin: PinIcon,
  unpin: PinSlashIcon,
  share: ShareIcon,
  rename: EditIcon,
  archive: ArchiveIcon,
  unarchive: UndoIcon,
  settings: SettingsIcon,
  signOut: LogOutIcon,
  uploadComputer: Computer,
  uploadCloud: Cloud,
  tool: ({ className }) => <ResolvedIcon className={className} />,
};

/** The page's drawing of an icon a menu entry names. */
export function MenuIconView({
  icon,
  className = "size-4",
}: {
  icon: MenuIcon;
  className?: string;
}) {
  if ("iconId" in icon) {
    return <ResolvedIcon iconId={icon.iconId} className={className} />;
  }
  const Icon = NAMED_MENU_ICONS[icon.name];
  return <Icon className={className} />;
}
