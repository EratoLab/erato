/* eslint-disable lingui/no-unlocalized-strings -- file paths and reasons for developers, never shown */
/**
 * Every popup menu the page draws, by the file that draws it: either a
 * described menu a host app can draw as a system menu, or a web menu with
 * the reason it stays one. The menu coverage test fails for a file that
 * draws a `DropdownMenu` or an `AnchoredPopover` and is in neither list.
 * Paths are relative to `src/`.
 */

export type ShellMenuName =
  | "addMenu"
  | "modelMenu"
  | "rowMenu"
  | "filterMenu"
  | "accountMenu";

interface ShellMenu {
  /**
   * `attach` for a button that stays put, so the app owns its touch;
   * `show` for a tap the page received on something that moves.
   */
  request: "show" | "attach";
  drawnBy: readonly string[];
}

export const SHELL_MENUS: Record<ShellMenuName, ShellMenu> = {
  addMenu: {
    request: "attach",
    drawnBy: ["components/ui/Chat/ChatInputAddMenu.tsx"],
  },
  // The composer's own model button, where it has room for one (a phone
  // turned sideways). The assistant form and Settings use it too, with a
  // "No default model" row this description does not have; those stay web.
  modelMenu: {
    request: "attach",
    drawnBy: ["components/ui/Chat/ModelSelector.tsx"],
  },
  rowMenu: {
    request: "show",
    drawnBy: ["components/ui/Chat/ChatHistoryList.tsx", "pages/SearchPage.tsx"],
  },
  filterMenu: {
    request: "show",
    drawnBy: ["components/ui/Chat/ChatHistoryFilterMenu.tsx"],
  },
  accountMenu: {
    request: "attach",
    drawnBy: ["components/ui/Controls/UserProfileDropdown.tsx"],
  },
};

type WebMenuReason =
  /** A system menu cannot draw it (free content, a field that keeps focus). */
  | { stays: "web"; why: string }
  /** Entries only, so a candidate; not described yet. */
  | { stays: "for now"; why: string }
  | { stays: "not on phones"; why: string };

export const WEB_MENUS: Record<string, WebMenuReason> = {
  "components/ui/Controls/DropdownMenu.tsx": {
    stays: "web",
    why: "the shared web drawing; each menu drawn with it is listed by its own file",
  },
  "components/ui/Chat/AssistantMentionPopover.tsx": {
    stays: "web",
    why: 'the "@" picker filters as the person types, and a system menu would take the keyboard away',
  },
  "components/ui/MessageList/MessageTextActionsToolbar.tsx": {
    stays: "web",
    why: "a toolbar on selected text (Quote, Explain), not a menu",
  },
  "components/ui/Chat/DelegationRunModePopover.tsx": {
    stays: "for now",
    why: "two choices with descriptions, opened from the send gesture",
  },
  "components/ui/Assistant/AssistantWelcomeScreen.tsx": {
    stays: "for now",
    why: "pin on a past chat's card",
  },
  "components/ui/Scheduled/ScheduledItemRow.tsx": {
    stays: "for now",
    why: "a scheduled item's actions, two of them confirmed",
  },
  "components/ui/Scheduled/ScheduledNewMenu.tsx": {
    stays: "for now",
    why: "the kinds of a new scheduled item",
  },
  "pages/AssistantsPage.tsx": {
    stays: "for now",
    why: "an assistant card's actions",
  },
  "components/ui/Settings/AudioInputTabContent.tsx": {
    stays: "for now",
    why: "the microphone choice in Settings",
  },
  "components/ui/Settings/McpToolPermissionsRoster.tsx": {
    stays: "for now",
    why: "a tool group's approval decision in Settings",
  },
  "components/ui/Settings/StartingAssistantSetting.tsx": {
    stays: "for now",
    why: "the starting assistant in Settings",
  },
  "components/ui/Chat/FacetSelector.tsx": {
    stays: "for now",
    why: 'the assistant form\'s tool choice; the composer has it in "+" on phones',
  },
  "components/ui/FileUpload/FileSourceSelector.tsx": {
    stays: "for now",
    why: 'the assistant form\'s file sources; the composer has them in "+" on phones',
  },
  "pages/DesktopSidecarSetupPage.tsx": {
    stays: "not on phones",
    why: "the desktop installer's download options",
  },
  "customer/examples/MessageControls.example.tsx": {
    stays: "not on phones",
    why: "a kit example mounted only in end-to-end tests",
  },
};
