/* eslint-disable lingui/no-unlocalized-strings -- the contract's capability, method and event names */
import type { AppMessage, Request } from "./systemMenus.v1.generated";
import type { HostShell } from "@/lib/hostShell";

/**
 * `systemMenus: 1`: its names here, its shapes typed from
 * `systemMenus.v1.schema.json` next to this file (`pnpm shell:types`).
 * Normative is the schema; the catalogue tests check documents against it.
 */
export const SYSTEM_MENUS_CAPABILITY = "systemMenus";
export const SYSTEM_MENUS_VERSION = 1;

export const SYSTEM_MENUS_METHOD = {
  show: "systemMenus.show",
  attach: "systemMenus.attach",
  update: "systemMenus.update",
  detach: "systemMenus.detach",
  confirm: "systemMenus.confirm",
} as const satisfies Record<string, Request["method"]>;

export const SYSTEM_MENUS_EVENT = {
  chosen: "systemMenus.chosen",
  toggled: "systemMenus.toggled",
  closed: "systemMenus.closed",
} as const satisfies Record<
  string,
  Extract<AppMessage, { event: string }>["event"]
>;

export type {
  AttachParams,
  AttachResult,
  ChosenEvent,
  ClosedEvent,
  ConfirmParams,
  ConfirmResult,
  DetachParams,
  Icon as ShellMenuIcon,
  MenuItem as ShellMenuItem,
  ShowParams,
  ShowResult,
  ToggledEvent,
  UpdateParams,
  UpdateResult,
  Request as SystemMenusRequest,
  AppMessage as SystemMenusAppMessage,
} from "./systemMenus.v1.generated";

/** Each method's parameters, as the contract types them. */
export type SystemMenusParams = {
  [R in Request as R["method"]]: R["params"];
};

/** A `systemMenus` call, its parameters typed by the contract. */
export const requestSystemMenus = <M extends keyof SystemMenusParams>(
  shell: HostShell,
  method: M,
  params: SystemMenusParams[M],
): Promise<unknown> => shell.request(method, params);
