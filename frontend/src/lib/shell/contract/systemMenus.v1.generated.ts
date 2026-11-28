/* Generated from systemMenus.v1.schema.json by `pnpm shell:types`. Do not edit. */

/**
 * What the page sends to a host app that offers `systemMenus: 1`, and what the app sends back. A host draws these menus the system's way; the page draws its own web menu when the capability is missing or the app answers `unsupported`. A document is either a request from the page or a message from the app.
 */
export type SystemMenus1 = Request | AppMessage;
/**
 * A call the page makes with `request(method, params)`.
 */
export type Request =
  | ShowRequest
  | AttachRequest
  | UpdateRequest
  | DetachRequest
  | ConfirmRequest;
/**
 * Chosen by the page; names one menu while it is shown or attached.
 */
export type MenuId = string;
/**
 * Plain text in the person's language, as the page shows it.
 */
export type Text = string;
/**
 * Unique within the whole menu, sub-menus and sections included.
 */
export type ItemId = string;
export type Items = MenuItem[];
/**
 * A result the app resolves a request with, or an event it sends.
 */
export type AppMessage =
  | ShowResultMessage
  | AttachResultMessage
  | UpdateResultMessage
  | ConfirmResultMessage
  | ChosenEventMessage
  | ToggledEventMessage
  | ClosedEventMessage;
export type ShowResult =
  | {
      shown: true;
      /**
       * The entry that closed the menu, or null when it was dismissed.
       */
      chosen: ItemId | null;
    }
  | Unsupported;
/**
 * Where the description has something this app does not draw, as JSON paths (`items[2].badge`).
 */
export type UnsupportedPaths = string[];
export type AttachResult =
  | {
      attached: true;
    }
  | {
      attached: false;
      unsupported: UnsupportedPaths;
    };
export type UpdateResult =
  | {
      /**
       * False when no menu has this id (it closed, or was detached).
       */
      updated: boolean;
    }
  | {
      updated: false;
      unsupported: UnsupportedPaths;
    };

export interface ShowRequest {
  method: "systemMenus.show";
  params: ShowParams;
}
/**
 * Shows a menu for a tap the page received (a chat row, anything that scrolls). Resolves when the menu closes.
 */
export interface ShowParams {
  id: MenuId;
  anchor: Anchor;
  title?: Text;
  items: Items;
}
/**
 * The element the menu belongs to, in CSS pixels as `getBoundingClientRect()` gives them.
 */
export interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}
/**
 * An entry, or with `children` a sub-menu or (with `inline`) a section. A tap on an entry that is not `keepOpen` closes the menu; on a `keepOpen` entry it flips the entry and the menu stays open.
 */
export interface MenuItem {
  id: ItemId;
  label?: Text;
  /**
   * Plain text in the person's language, as the page shows it.
   */
  subtitle?: string;
  icon?: Icon;
  /**
   * A tick. Every child of a parent with `selection` has one.
   */
  state?: "on" | "off";
  /**
   * On a parent: its children are one choice (`single`, at most one on) or several (`multiple`).
   */
  selection?: "single" | "multiple";
  disabled?: boolean;
  /**
   * Plain text in the person's language, as the page shows it.
   */
  disabledReason?: string;
  /**
   * The menu stays open after a tap on this entry; the app sends `systemMenus.toggled` instead of choosing it.
   */
  keepOpen?: boolean;
  /**
   * On a parent: its children are a section of this menu (with `label` as its header), not a sub-menu.
   */
  inline?: boolean;
  children?: MenuItem[];
}
/**
 * The page's own icon, drawn by the page. The app uses only its shape (the alpha channel) and tints it the system's way.
 */
export interface Icon {
  /**
   * A square PNG, base64 without a `data:` prefix, at least 48 pixels on a side.
   */
  png: string;
}
export interface AttachRequest {
  method: "systemMenus.attach";
  params: AttachParams;
}
/**
 * Puts the app's own touch over a page button that stays put (the composer's "+", the account button), so press-and-slide works. Lasts until `detach` or until another page starts to show.
 */
export interface AttachParams {
  id: MenuId;
  anchor: Anchor;
  items: Items;
}
export interface UpdateRequest {
  method: "systemMenus.update";
  params: UpdateParams;
}
/**
 * New entries or a new place for a shown or attached menu; an open menu changes in place.
 */
export interface UpdateParams {
  id: MenuId;
  anchor?: Anchor;
  items?: Items;
}
export interface DetachRequest {
  method: "systemMenus.detach";
  params: DetachParams;
}
export interface DetachParams {
  id: MenuId;
}
export interface ConfirmRequest {
  method: "systemMenus.confirm";
  params: ConfirmParams;
}
/**
 * Asks before an action takes effect, as the system's action sheet. The app adds the cancel button with `cancelLabel`.
 */
export interface ConfirmParams {
  title: Text;
  message?: Text;
  anchor?: Anchor;
  cancelLabel: Text;
  actions: {
    id: ItemId;
    label: Text;
  }[];
}
export interface ShowResultMessage {
  result: "systemMenus.show";
  value: ShowResult;
}
/**
 * The app cannot draw the description; the page shows its web menu instead.
 */
export interface Unsupported {
  shown: false;
  unsupported: UnsupportedPaths;
}
export interface AttachResultMessage {
  result: "systemMenus.attach";
  value: AttachResult;
}
export interface UpdateResultMessage {
  result: "systemMenus.update";
  value: UpdateResult;
}
export interface ConfirmResultMessage {
  result: "systemMenus.confirm";
  value: ConfirmResult;
}
export interface ConfirmResult {
  /**
   * The action picked, or null for cancel.
   */
  chosen: ItemId | null;
}
export interface ChosenEventMessage {
  event: "systemMenus.chosen";
  payload: ChosenEvent;
}
/**
 * An entry closed an attached menu.
 */
export interface ChosenEvent {
  id: MenuId;
  itemId: ItemId;
}
export interface ToggledEventMessage {
  event: "systemMenus.toggled";
  payload: ToggledEvent;
}
/**
 * A `keepOpen` entry of a shown or attached menu was tapped; `on` is the state the person asked for. The menu shows it until the page sends `update`.
 */
export interface ToggledEvent {
  id: MenuId;
  itemId: ItemId;
  on: boolean;
}
export interface ClosedEventMessage {
  event: "systemMenus.closed";
  payload: ClosedEvent;
}
/**
 * An attached menu closed, by a choice or a dismissal.
 */
export interface ClosedEvent {
  id: MenuId;
}
