import { describe, expect, it } from "vitest";

import { schemaChecks } from "@/lib/shell/catalogue/schemaChecks";
import schema from "@/lib/shell/contract/systemMenus.v1.schema.json";

import {
  ADD_MENU_FIXTURES,
  ADD_MENU_STATE_KEYS,
} from "./__fixtures__/addMenu.fixtures";
import { buildSystemMenusCatalogue } from "./catalogue";
import { menuRuleViolations } from "./menuRules";
import { SHELL_MENUS, WEB_MENUS } from "./registry";

import type { ShellMenuItem } from "@/lib/shell/contract/systemMenus";

const checks = schemaChecks(schema);
const catalogue = buildSystemMenusCatalogue();
const { menus } = catalogue.index;

const itemsOf = (document: unknown): ShellMenuItem[] | undefined => {
  const params = (document as { params?: { items?: ShellMenuItem[] } }).params;
  return params?.items;
};

describe("the systemMenus catalogue", () => {
  it.each(catalogue.documents.map(({ name, document }) => [name, document]))(
    "%s fits the schema",
    (_name, document) => {
      expect(checks.errors(document)).toEqual([]);
    },
  );

  it("holds each menu to the rules the schema cannot say", () => {
    const breaches = catalogue.documents.flatMap(({ name, document }) => {
      const items = itemsOf(document);
      return items ? menuRuleViolations(items).map((v) => `${name}: ${v}`) : [];
    });
    expect(breaches).toEqual([]);
  });

  it("uses every property, value and alternative of the schema", () => {
    const documents = catalogue.documents.map(({ document }) => document);
    expect(checks.unused(documents)).toEqual([]);
  });

  it("describes every fixture of every registered menu, or keeps it web", () => {
    expect(Object.keys(menus).sort()).toEqual(Object.keys(SHELL_MENUS).sort());
    for (const [menu, { fixtures }] of Object.entries(menus)) {
      expect(Object.keys(fixtures).length, menu).toBeGreaterThan(0);
      for (const name of Object.values(fixtures)) {
        if (name === null) continue;
        const document = catalogue.documents.find((d) => d.name === name);
        expect(itemsOf(document?.document)?.length, name).toBeGreaterThan(0);
      }
    }
    expect(menus.addMenu.fixtures.hostContent).toBeNull();
  });

  it("names each document once", () => {
    const names = catalogue.documents.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the add menu fixtures", () => {
  it.each(ADD_MENU_STATE_KEYS)("vary %s", (key) => {
    const values = new Set(
      Object.values(ADD_MENU_FIXTURES).map((state) =>
        JSON.stringify(state[key]),
      ),
    );
    expect(values.size).toBeGreaterThan(1);
  });
});

const MENU_TAG = /<(DropdownMenu|AnchoredPopover)\b/;
const sources = import.meta.glob<string>(
  [
    "/src/**/*.tsx",
    "!/src/**/*.test.tsx",
    "!/src/**/*.stories.tsx",
    "!/src/stories/**",
  ],
  { query: "?raw", import: "default", eager: true },
);
const menuFiles = Object.entries(sources)
  .filter(([, text]) => MENU_TAG.test(text))
  .map(([path]) => path.replace(/^\/src\//, ""))
  .sort();

describe("menu coverage", () => {
  const described = Object.values(SHELL_MENUS).flatMap((menu) => menu.drawnBy);
  const kept = Object.keys(WEB_MENUS);

  it("registers every file that draws a menu", () => {
    const unregistered = menuFiles.filter(
      (file) => !described.includes(file) && !kept.includes(file),
    );
    expect(unregistered).toEqual([]);
  });

  it("lists no file twice and none that draws no menu", () => {
    const listed = [...described, ...kept];
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((file) => !menuFiles.includes(file))).toEqual([]);
  });
});

describe("the systemMenus schema", () => {
  const show = (items: unknown[]) => ({
    method: "systemMenus.show",
    params: { id: "m", anchor: { x: 0, y: 0, width: 1, height: 1 }, items },
  });
  const entry = (id: string, more: object = {}) => ({ id, label: id, ...more });

  it.each([
    ["an unknown field", [entry("a", { badge: "3" })]],
    ["an entry without a label", [{ id: "a" }]],
    ["keepOpen without a state", [entry("a", { keepOpen: true })]],
    ["a reason on an entry that is on", [entry("a", { disabledReason: "No" })]],
    [
      "a tick on a sub-menu",
      [entry("s", { state: "on", children: [entry("a")] })],
    ],
    [
      "a subtitle on a section",
      [{ id: "s", inline: true, subtitle: "x", children: [entry("a")] }],
    ],
    ["a sub-menu without a label", [{ id: "s", children: [entry("a")] }]],
    [
      "a section inside a section",
      [
        {
          id: "s",
          inline: true,
          children: [{ id: "t", inline: true, children: [entry("a")] }],
        },
      ],
    ],
    [
      "two ticks in one choice",
      [
        entry("s", {
          selection: "single",
          children: [entry("a", { state: "on" }), entry("b", { state: "on" })],
        }),
      ],
    ],
    [
      "a choice with an entry that has no state",
      [entry("s", { selection: "multiple", children: [entry("a")] })],
    ],
    [
      "an icon that is not a PNG",
      [entry("a", { icon: { png: "R0lGODlhAQABAAAAACw=" } })],
    ],
    ["an empty menu", []],
  ])("refuses %s", (_case, items) => {
    expect(checks.errors(show(items))).not.toEqual([]);
  });
});
