/* eslint-disable lingui/no-unlocalized-strings -- document names and sample ids of the catalogue */
import {
  SYSTEM_MENUS_CAPABILITY,
  SYSTEM_MENUS_EVENT,
  SYSTEM_MENUS_METHOD,
  SYSTEM_MENUS_VERSION,
} from "@/lib/shell/contract/systemMenus";

import { ACCOUNT_MENU_FIXTURES } from "./__fixtures__/accountMenu.fixtures";
import { ADD_MENU_FIXTURES } from "./__fixtures__/addMenu.fixtures";
import { FILTER_MENU_FIXTURES } from "./__fixtures__/filterMenu.fixtures";
import { MODEL_MENU_FIXTURES } from "./__fixtures__/modelMenu.fixtures";
import { ROW_MENU_FIXTURES } from "./__fixtures__/rowMenu.fixtures";
import { describeAccountMenu } from "./describeAccountMenu";
import { describeAddMenu } from "./describeAddMenu";
import { describeFilterMenu } from "./describeFilterMenu";
import { describeModelMenu } from "./describeModelMenu";
import { describeRowMenu } from "./describeRowMenu";
import {
  CONFIRM_ACTION_ID,
  confirmParams,
  toShellMenuItems,
} from "./menuEntry";
import { SHELL_MENUS } from "./registry";

import type { MenuConfirm, MenuDescription, MenuEntry } from "./menuEntry";
import type { ShellMenuName } from "./registry";
import type { ShellAnchor } from "@/lib/hostShell";
import type { CapabilityCatalogue } from "@/lib/shell/catalogue/capabilityCatalogue";
import type {
  ShellMenuItem,
  SystemMenusAppMessage,
  SystemMenusRequest,
} from "@/lib/shell/contract/systemMenus";

/** A 48 px circle: every icon in the catalogue is drawn as this picture. */
const CATALOGUE_ICON_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAcklEQVR42u2ZsQ0AIAzD+P/pcAISAtoEW8peT5R0DACANLSI5dBtZXQotoOXiOhyrIe/KqHHsR7+uIS1gIrzt4CaBAFLATULAggggAAC/74FrBJspPwH+BObC9jXKhHFVkS1GFHuRtTrMQeOmBMTAMAeE+2N+DKyUB6+AAAAAElFTkSuQmCC";

const ANCHOR: ShellAnchor = { x: 12, y: 780, width: 40, height: 40 };
const MOVED_ANCHOR: ShellAnchor = { x: 12, y: 452, width: 40, height: 40 };

/** Per menu and fixture: the document's name, or null where it stays web. */
type CatalogueMenus = Record<
  ShellMenuName,
  { request: "show" | "attach"; fixtures: Record<string, string | null> }
>;

/** Document names are `<menu>.<fixture>`, or `app.<case>`. */
type SystemMenusCatalogue = CapabilityCatalogue<
  SystemMenusRequest | SystemMenusAppMessage,
  { menus: CatalogueMenus }
>;

type CatalogueDocument = SystemMenusCatalogue["documents"][number];

interface Described {
  entries: MenuDescription;
  title?: string;
}

const describedMenus = (): Record<ShellMenuName, Record<string, Described>> => {
  const each = <F>(
    fixtures: Record<string, F>,
    describe: (fixture: F) => Described,
  ) =>
    Object.fromEntries(
      Object.entries(fixtures).map(([name, fixture]) => [
        name,
        describe(fixture),
      ]),
    );
  return {
    addMenu: each(ADD_MENU_FIXTURES, (state) => ({
      entries: describeAddMenu(state),
    })),
    modelMenu: each(MODEL_MENU_FIXTURES, (state) => ({
      entries: describeModelMenu(state, { descriptions: true }),
    })),
    rowMenu: each(ROW_MENU_FIXTURES, ({ state, gates, title }) => ({
      entries: describeRowMenu(state, gates),
      title,
    })),
    filterMenu: each(FILTER_MENU_FIXTURES, ({ values, capabilities }) => ({
      entries: describeFilterMenu(values, capabilities),
    })),
    accountMenu: each(ACCOUNT_MENU_FIXTURES, (state) => ({
      entries: describeAccountMenu(state),
    })),
  };
};

const wireItems = (entries: readonly MenuEntry[]): ShellMenuItem[] =>
  toShellMenuItems(entries, () => ({ png: CATALOGUE_ICON_PNG }));

const confirmations = (
  entries: readonly MenuEntry[],
): { id: string; confirm: MenuConfirm }[] =>
  entries.flatMap((entry) => [
    ...(entry.confirm ? [{ id: entry.id, confirm: entry.confirm }] : []),
    ...confirmations(entry.children ?? []),
  ]);

/** Results and events in every shape the page accepts from the app. */
const appMessages = (): CatalogueDocument[] => [
  {
    name: "app.show.chosen",
    document: {
      result: SYSTEM_MENUS_METHOD.show,
      value: { shown: true, chosen: "archive" },
    },
  },
  {
    name: "app.show.dismissed",
    document: {
      result: SYSTEM_MENUS_METHOD.show,
      value: { shown: true, chosen: null },
    },
  },
  {
    name: "app.show.unsupported",
    document: {
      result: SYSTEM_MENUS_METHOD.show,
      value: { shown: false, unsupported: ["items[2].badge"] },
    },
  },
  {
    name: "app.attach.attached",
    document: { result: SYSTEM_MENUS_METHOD.attach, value: { attached: true } },
  },
  {
    name: "app.attach.unsupported",
    document: {
      result: SYSTEM_MENUS_METHOD.attach,
      value: { attached: false, unsupported: ["items[0].children[1].state"] },
    },
  },
  {
    name: "app.update.updated",
    document: { result: SYSTEM_MENUS_METHOD.update, value: { updated: true } },
  },
  {
    name: "app.update.gone",
    document: { result: SYSTEM_MENUS_METHOD.update, value: { updated: false } },
  },
  {
    name: "app.update.unsupported",
    document: {
      result: SYSTEM_MENUS_METHOD.update,
      value: { updated: false, unsupported: ["items[1].badge"] },
    },
  },
  {
    name: "app.confirm.chosen",
    document: {
      result: SYSTEM_MENUS_METHOD.confirm,
      value: { chosen: CONFIRM_ACTION_ID },
    },
  },
  {
    name: "app.confirm.cancelled",
    document: { result: SYSTEM_MENUS_METHOD.confirm, value: { chosen: null } },
  },
  {
    name: "app.event.chosen",
    document: {
      event: SYSTEM_MENUS_EVENT.chosen,
      payload: { id: "addMenu", itemId: "upload:computer" },
    },
  },
  {
    name: "app.event.toggled",
    document: {
      event: SYSTEM_MENUS_EVENT.toggled,
      payload: { id: "addMenu", itemId: "tool:web_search", on: false },
    },
  },
  {
    name: "app.event.closed",
    document: { event: SYSTEM_MENUS_EVENT.closed, payload: { id: "addMenu" } },
  },
];

/**
 * Every menu the page can send in every setting the fixtures cover, as the
 * requests it would make, plus the app's answers it accepts. Labels are in
 * the active locale.
 */
export function buildSystemMenusCatalogue(): SystemMenusCatalogue {
  const described = describedMenus();
  const documents: CatalogueDocument[] = [];
  const menus = {} as CatalogueMenus;

  for (const [menu, fixtures] of Object.entries(described) as [
    ShellMenuName,
    Record<string, Described>,
  ][]) {
    const { request } = SHELL_MENUS[menu];
    menus[menu] = { request, fixtures: {} };
    for (const [fixture, { entries, title }] of Object.entries(fixtures)) {
      if (entries === null) {
        menus[menu].fixtures[fixture] = null;
        continue;
      }
      const name = `${menu}.${fixture}`;
      menus[menu].fixtures[fixture] = name;
      const params = { id: menu, anchor: ANCHOR, items: wireItems(entries) };
      documents.push({
        name,
        document:
          request === "show"
            ? {
                method: SYSTEM_MENUS_METHOD.show,
                params: { ...params, ...(title ? { title } : {}) },
              }
            : { method: SYSTEM_MENUS_METHOD.attach, params },
      });
      for (const { id, confirm } of confirmations(entries)) {
        documents.push({
          name: `${name}.confirm-${id}`,
          document: {
            method: SYSTEM_MENUS_METHOD.confirm,
            params: confirmParams(confirm, ANCHOR),
          },
        });
      }
    }
  }

  // While the "+" menu is open, a second tool is switched on (the page's
  // entries after `toggled`) and the keyboard moves its button.
  const { tools } = ADD_MENU_FIXTURES;
  const toggled = describeAddMenu({
    ...tools,
    selectedFacetIds: tools.facets.slice(0, 2).map((facet) => facet.id),
  });
  if (toggled) {
    documents.push({
      name: "addMenu.update-toggled",
      document: {
        method: SYSTEM_MENUS_METHOD.update,
        params: { id: "addMenu", items: wireItems(toggled) },
      },
    });
  }
  documents.push(
    {
      name: "addMenu.update-anchor",
      document: {
        method: SYSTEM_MENUS_METHOD.update,
        params: { id: "addMenu", anchor: MOVED_ANCHOR },
      },
    },
    {
      name: "addMenu.detach",
      document: {
        method: SYSTEM_MENUS_METHOD.detach,
        params: { id: "addMenu" },
      },
    },
    ...appMessages(),
  );

  return {
    capability: SYSTEM_MENUS_CAPABILITY,
    version: SYSTEM_MENUS_VERSION,
    documents,
    index: { menus },
  };
}
