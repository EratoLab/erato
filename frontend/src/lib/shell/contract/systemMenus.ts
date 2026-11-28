/* eslint-disable lingui/no-unlocalized-strings -- the contract's capability, method and event names */
import type { ShellAnchor } from "@/lib/hostShell";

/**
 * The shapes of `systemMenus: 1`. Normative is `systemMenus.v1.schema.json`
 * next to this file; the catalogue tests hold these types to it.
 */
export const SYSTEM_MENUS_CAPABILITY = "systemMenus";
export const SYSTEM_MENUS_VERSION = 1;

export const SYSTEM_MENUS_METHOD = {
  show: "systemMenus.show",
  attach: "systemMenus.attach",
  update: "systemMenus.update",
  detach: "systemMenus.detach",
  confirm: "systemMenus.confirm",
} as const;

export const SYSTEM_MENUS_EVENT = {
  chosen: "systemMenus.chosen",
  toggled: "systemMenus.toggled",
  closed: "systemMenus.closed",
} as const;

export interface ShellMenuIcon {
  /** Base64 PNG without a `data:` prefix; the app uses only its alpha. */
  png: string;
}

export interface ShellMenuItem {
  id: string;
  label?: string;
  subtitle?: string;
  icon?: ShellMenuIcon;
  state?: "on" | "off";
  selection?: "single" | "multiple";
  disabled?: boolean;
  disabledReason?: string;
  keepOpen?: boolean;
  inline?: boolean;
  children?: ShellMenuItem[];
}

export interface ShowParams {
  id: string;
  anchor: ShellAnchor;
  title?: string;
  items: ShellMenuItem[];
}

export type ShowResult =
  | { shown: true; chosen: string | null }
  | { shown: false; unsupported: string[] };

export type AttachParams = Omit<ShowParams, "title">;

export type AttachResult =
  | { attached: true }
  | { attached: false; unsupported: string[] };

export interface UpdateParams {
  id: string;
  anchor?: ShellAnchor;
  items?: ShellMenuItem[];
}

export type UpdateResult =
  | { updated: boolean }
  | { updated: false; unsupported: string[] };

export interface DetachParams {
  id: string;
}

export interface ConfirmAction {
  id: string;
  label: string;
}

export interface ConfirmParams {
  title: string;
  message?: string;
  anchor?: ShellAnchor;
  cancelLabel: string;
  actions: ConfirmAction[];
}

export interface ConfirmResult {
  chosen: string | null;
}

export interface ChosenEvent {
  id: string;
  itemId: string;
}

export interface ToggledEvent {
  id: string;
  itemId: string;
  on: boolean;
}

export interface ClosedEvent {
  id: string;
}

export type SystemMenusRequest =
  | { method: typeof SYSTEM_MENUS_METHOD.show; params: ShowParams }
  | { method: typeof SYSTEM_MENUS_METHOD.attach; params: AttachParams }
  | { method: typeof SYSTEM_MENUS_METHOD.update; params: UpdateParams }
  | { method: typeof SYSTEM_MENUS_METHOD.detach; params: DetachParams }
  | { method: typeof SYSTEM_MENUS_METHOD.confirm; params: ConfirmParams };

export type SystemMenusAppMessage =
  | { result: typeof SYSTEM_MENUS_METHOD.show; value: ShowResult }
  | { result: typeof SYSTEM_MENUS_METHOD.attach; value: AttachResult }
  | { result: typeof SYSTEM_MENUS_METHOD.update; value: UpdateResult }
  | { result: typeof SYSTEM_MENUS_METHOD.confirm; value: ConfirmResult }
  | { event: typeof SYSTEM_MENUS_EVENT.chosen; payload: ChosenEvent }
  | { event: typeof SYSTEM_MENUS_EVENT.toggled; payload: ToggledEvent }
  | { event: typeof SYSTEM_MENUS_EVENT.closed; payload: ClosedEvent };
