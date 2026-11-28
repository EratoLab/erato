import { t } from "@lingui/core/macro";

import type { MenuEntry } from "./menuEntry";

export const ACCOUNT_MENU_ID = {
  settings: "settings",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- entry id
  signOut: "signOut",
} as const;

export interface AccountMenuState {
  /** The server lets this person sign out here (the auth feature's `showLogout`). */
  showLogout: boolean;
}

export function describeAccountMenu({
  showLogout,
}: AccountMenuState): MenuEntry[] {
  return [
    {
      id: ACCOUNT_MENU_ID.settings,
      label: t({ id: "profile.menu.preferences", message: "Settings" }),
      icon: { name: "settings" },
    },
    ...(showLogout
      ? [
          {
            id: ACCOUNT_MENU_ID.signOut,
            label: t`Sign out`,
            icon: { name: "signOut" as const },
          },
        ]
      : []),
  ];
}
