import { describe, expect, it } from "vitest";

import { ACCOUNT_MENU_FIXTURES } from "./__fixtures__/accountMenu.fixtures";
import { ADD_MENU_FIXTURES } from "./__fixtures__/addMenu.fixtures";
import { FILTER_MENU_FIXTURES } from "./__fixtures__/filterMenu.fixtures";
import { MODEL_MENU_FIXTURES } from "./__fixtures__/modelMenu.fixtures";
import { ROW_MENU_FIXTURES } from "./__fixtures__/rowMenu.fixtures";
import { describeAccountMenu } from "./describeAccountMenu";
import { describeAddMenu, toolChoice } from "./describeAddMenu";
import {
  applyFilterMenuChoice,
  describeFilterMenu,
  filterMenuChoice,
} from "./describeFilterMenu";
import { describeModelMenu, modelChoice } from "./describeModelMenu";
import { describeRowMenu } from "./describeRowMenu";
import { findMenuEntry, menuIcons, toShellMenuItems } from "./menuEntry";
import { menuRuleViolations } from "./menuRules";

import type { MenuEntry } from "./menuEntry";

const row = (name: keyof typeof ROW_MENU_FIXTURES) => {
  const { state, gates } = ROW_MENU_FIXTURES[name];
  return describeRowMenu(state, gates);
};
const ids = (entries: readonly MenuEntry[]) => entries.map((entry) => entry.id);
const leaves = (entries: readonly MenuEntry[]): MenuEntry[] =>
  entries.flatMap((entry) =>
    entry.children ? leaves(entry.children) : [entry],
  );

describe("describeRowMenu", () => {
  it("offers pin, share, rename and archive on an idle chat", () => {
    expect(ids(row("idle"))).toEqual(["pin", "share", "rename", "archive"]);
    expect(
      row("idle").some(
        (entry) => entry.disabled === true || entry.confirm !== undefined,
      ),
    ).toBe(false);
  });

  it("asks before archiving work under way, and only then", () => {
    for (const name of [
      "status-running",
      "status-action_required",
      "waitingOnly",
    ]) {
      const archive = findMenuEntry(row(name), "archive");
      expect(archive?.confirm?.message, name).toBeTruthy();
      expect(archive?.confirm?.title).toBe("Archive this chat?");
    }
    for (const name of ["status-finished", "status-error"]) {
      expect(
        findMenuEntry(row(name), "archive")?.confirm,
        name,
      ).toBeUndefined();
    }
  });

  it("says when the pin limit is reached, and still lets a pinned chat go", () => {
    expect(findMenuEntry(row("pinLimitReached"), "pin")).toMatchObject({
      label: "Pin limit reached",
      disabled: true,
    });
    expect(findMenuEntry(row("pinned"), "pin")).toMatchObject({
      label: "Unpin",
      icon: { name: "unpin" },
    });
    expect(findMenuEntry(row("pinned"), "pin")?.disabled).toBeUndefined();
  });

  it("gives an archived chat only unarchive, and a run no archive at all", () => {
    expect(ids(row("archived"))).toEqual(["rename", "unarchive"]);
    expect(ids(row("run"))).toEqual(["pin", "share", "rename"]);
  });

  it("leaves out what the surface does not handle", () => {
    expect(ids(row("pinningAndSharingOff"))).toEqual(["rename", "archive"]);
  });
});

describe("describeFilterMenu", () => {
  const filter = (name: keyof typeof FILTER_MENU_FIXTURES) => {
    const { values, capabilities } = FILTER_MENU_FIXTURES[name];
    return describeFilterMenu(values, capabilities);
  };

  it("carries each row's current value as data", () => {
    const entries = filter("changed");
    expect(findMenuEntry(entries, "type")?.subtitle).toBe("Assistant");
    expect(findMenuEntry(entries, "status")?.subtitle).toBe("All");
    expect(findMenuEntry(entries, "groupBy")?.subtitle).toBe("Unread");
    expect(findMenuEntry(entries, "type")?.selection).toBe("single");
  });

  it("shows only the rows the deployment has", () => {
    const rows = (name: keyof typeof FILTER_MENU_FIXTURES) =>
      ids(filter(name)[0].children ?? []);
    expect(rows("defaults")).toEqual(["type", "status", "delegated", "source"]);
    expect(rows("assistantsWithoutDelegation")).toEqual([
      "type",
      "status",
      "source",
    ]);
    expect(rows("plain")).toEqual(["status"]);
    expect(
      ids(findMenuEntry(filter("plain"), "groupBy")?.children ?? []),
    ).not.toContain("groupBy:type");
  });

  it("keeps the source menu open and its sources off until a mode needs them", () => {
    const all = findMenuEntry(filter("source-all"), "source");
    expect(leaves([all as MenuEntry]).every((entry) => entry.keepOpen)).toBe(
      true,
    );
    expect(findMenuEntry(filter("source-all"), "source:teams")?.disabled).toBe(
      true,
    );
    expect(findMenuEntry(filter("source-only"), "source:teams")).toMatchObject({
      state: "on",
    });
    expect(findMenuEntry(filter("source-only"), "source")?.subtitle).toBe(
      "Only: Outlook, Teams",
    );
  });

  it("turns each entry back into the pick both drawings apply", () => {
    const applied: string[] = [];
    const record = (name: string) => (value?: unknown) =>
      applied.push(value === undefined ? name : `${name}=${String(value)}`);
    const setters = {
      setTypeFilter: record("type"),
      setStatusFilter: record("status"),
      setDelegatedFilter: record("delegated"),
      setGroupBy: record("groupBy"),
      setSourceMode: record("sourceMode"),
      toggleSource: record("source"),
      resetToDefaults: record("reset"),
    };
    for (const entry of leaves(filter("defaults"))) {
      const choice = filterMenuChoice(entry.id);
      expect(choice, entry.id).not.toBeNull();
      if (choice) applyFilterMenuChoice(choice, setters);
    }
    expect(applied).toContain("groupBy=unread");
    expect(applied).toContain("source=teams");
    expect(applied).toContain("reset");
    expect(filterMenuChoice("type:everything")).toBeNull();
    expect(filterMenuChoice("type")).toBeNull();
  });
});

describe("describeAddMenu", () => {
  const add = (name: keyof typeof ADD_MENU_FIXTURES) =>
    describeAddMenu(ADD_MENU_FIXTURES[name]) ?? [];

  it("stays web while a host draws rows of its own", () => {
    expect(describeAddMenu(ADD_MENU_FIXTURES.hostContent)).toBeNull();
  });

  it("draws the tools as toggles that keep the menu open", () => {
    const tools = findMenuEntry(add("tools"), "section:tools");
    expect(tools).toMatchObject({
      label: "Tools",
      selection: "multiple",
      inline: true,
    });
    expect(
      tools?.children?.map((tool) => [tool.id, tool.state, tool.keepOpen]),
    ).toEqual([
      ["tool:web_search", "on", true],
      ["tool:image_generation", "off", true],
      ["tool:deep_research", "off", true],
    ]);
    expect(toolChoice("tool:web_search")).toBe("web_search");
  });

  it("says why locked tools are off, where the composer has no chips for it", () => {
    const locked = findMenuEntry(add("toolsLocked"), "tool:web_search");
    expect(locked).toMatchObject({
      disabled: true,
      disabledReason: "This assistant sets the tools for its chats.",
    });
    const quiet = findMenuEntry(add("toolsLockedQuietly"), "tool:web_search");
    expect(quiet?.disabled).toBe(true);
    expect(quiet?.disabledReason).toBeUndefined();
  });

  it("makes the tools one choice where the server allows one at a time", () => {
    expect(
      findMenuEntry(add("oneToolAtATime"), "section:tools")?.selection,
    ).toBe("single");
  });

  it("opens many models as a menu with the choice as its subtitle", () => {
    const model = findMenuEntry(add("models"), "model");
    expect(model).toMatchObject({
      subtitle: "Claude Sonnet 5.5",
      selection: "single",
    });
    expect(findMenuEntry(add("oneModel"), "model")).toBeUndefined();
    expect(findMenuEntry(add("oneModel"), "section:model")).toMatchObject({
      label: "Model",
      selection: "single",
    });
  });

  it("holds every row while files upload", () => {
    const rows = leaves(add("busy"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((entry) => entry.disabled)).toBe(true);
    expect(findMenuEntry(add("modelsBusy"), "model")?.disabled).toBe(true);
  });

  it("reads the connectors' and assistants' texts from the web menu's own rows", () => {
    expect(
      findMenuEntry(add("connectorsOffAndReadOnly"), "connectors"),
    ).toMatchObject({
      label: "Connectors…",
      subtitle: "Off: Ticket tracker · 1 to connect · read only",
    });
    expect(findMenuEntry(add("assistants"), "ask-assistant")?.subtitle).toBe(
      "Contract reviewer and 1 more you use often",
    );
  });
});

describe("describeModelMenu", () => {
  it("keeps each model's name apart from its provider's icon", () => {
    const [first, , last] = describeModelMenu(MODEL_MENU_FIXTURES.many, {
      descriptions: true,
    });
    expect(first).toMatchObject({
      label: "GPT-5.4 Mini (EU)",
      subtitle: "Fast answers, hosted in the EU",
      icon: { iconId: "openai" },
      state: "off",
    });
    expect(last.icon).toBeUndefined();
    expect(modelChoice(first.id)).toBe("gpt-5-4-mini-eu");
    expect(
      describeModelMenu(MODEL_MENU_FIXTURES.notReady, {
        descriptions: true,
      })[0].disabled,
    ).toBe(true);
  });
});

describe("describeAccountMenu", () => {
  it("offers sign out only where the server has it", () => {
    expect(ids(describeAccountMenu(ACCOUNT_MENU_FIXTURES.withSignOut))).toEqual(
      ["settings", "signOut"],
    );
    expect(
      ids(describeAccountMenu(ACCOUNT_MENU_FIXTURES.withoutSignOut)),
    ).toEqual(["settings"]);
  });
});

describe("toShellMenuItems", () => {
  const entries: MenuEntry[] = [
    {
      id: "section",
      inline: true,
      children: [
        {
          id: "a",
          label: "A",
          icon: { name: "pin" },
          confirm: {
            title: "Sure?",
            confirmLabel: "Confirm",
            cancelLabel: "Cancel",
          },
        },
        { id: "b", label: "B", icon: { iconId: "openai" } },
      ],
    },
  ];

  it("draws each icon once and keeps confirmations in the page", () => {
    expect(menuIcons(entries)).toEqual([{ name: "pin" }, { iconId: "openai" }]);
    const items = toShellMenuItems(entries, (icon) =>
      "name" in icon ? { png: "pin" } : undefined,
    );
    expect(items).toEqual([
      {
        id: "section",
        inline: true,
        children: [
          { id: "a", label: "A", icon: { png: "pin" } },
          { id: "b", label: "B" },
        ],
      },
    ]);
  });
});

describe("menuRuleViolations", () => {
  it("finds an id used twice in one menu", () => {
    expect(
      menuRuleViolations([
        { id: "x", label: "X" },
        { id: "s", inline: true, children: [{ id: "x", label: "X again" }] },
      ]),
    ).toEqual(['items[1].children[0].id repeats items[0].id ("x")']);
  });
});
