import type { AccountMenuState } from "../describeAccountMenu";

export const ACCOUNT_MENU_FIXTURES: Record<string, AccountMenuState> = {
  withSignOut: { showLogout: true },
  // A server whose sign-in leaves no way to sign out in the page.
  withoutSignOut: { showLogout: false },
};
