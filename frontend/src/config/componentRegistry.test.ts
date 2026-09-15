import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ERATO_SHARED_SURFACE_MINOR,
  EXTENSION_POINT_REQUIRED_SURFACE_MINOR,
} from "@/shared/surfaceVersion";

import type {
  ComponentKitRegistration,
  ComponentRegistry,
} from "./componentRegistry";
import type { ComponentKitVersionStance } from "@/shared/surfaceVersion";
import type { ComponentType } from "react";

const component = <TProps>(name: string): ComponentType<TProps> => {
  const Component = () => null;
  Component.displayName = name;
  return Component as ComponentType<TProps>;
};

type ComponentPropsFor<TKey extends keyof ComponentRegistry> =
  NonNullable<ComponentRegistry[TKey]> extends ComponentType<infer TProps>
    ? TProps
    : never;

const loadRegistry = async () => {
  vi.resetModules();
  return import("./componentRegistry");
};

describe("componentRegistry", () => {
  afterEach(() => {
    delete window.ERATO_COMPONENT_KITS;
    vi.resetModules();
  });

  it("uses lower priority component kit registrations first", async () => {
    const lowPriority =
      component<ComponentPropsFor<"ChatWelcomeScreen">>("LowPriority");
    const highPriority =
      component<ComponentPropsFor<"ChatWelcomeScreen">>("HighPriority");
    window.ERATO_COMPONENT_KITS = [
      {
        name: "low",
        components: [
          {
            extensionPoint: "ChatWelcomeScreen",
            component: lowPriority,
            priority: 50,
          },
        ],
      },
      {
        name: "high",
        components: [
          {
            extensionPoint: "ChatWelcomeScreen",
            component: highPriority,
            priority: 10,
          },
        ],
      },
    ] satisfies ComponentKitRegistration[];

    const { componentRegistry } = await loadRegistry();

    expect(componentRegistry.ChatWelcomeScreen).toBe(highPriority);
  });

  it("lets the last loaded equal-priority registration win", async () => {
    const first = component<ComponentPropsFor<"MessageControls">>("First");
    const second = component<ComponentPropsFor<"MessageControls">>("Second");
    window.ERATO_COMPONENT_KITS = [
      {
        name: "first",
        components: [
          {
            extensionPoint: "MessageControls",
            component: first,
            priority: 50,
          },
        ],
      },
      {
        name: "second",
        components: [
          {
            extensionPoint: "MessageControls",
            component: second,
            priority: 50,
          },
        ],
      },
    ] satisfies ComponentKitRegistration[];

    const { componentRegistry } = await loadRegistry();

    expect(componentRegistry.MessageControls).toBe(second);
  });
});

describe("shared surface requirements", () => {
  let consoleError = vi.spyOn(console, "error");

  // The requirement this repo actually records; the fixtures below read it so
  // they keep testing "behind"/"current" rather than a frozen number.
  const REQUIRED = EXTENSION_POINT_REQUIRED_SURFACE_MINOR.ChatHistoryList ?? 0;

  const list = component<ComponentPropsFor<"ChatHistoryList">>("KitList");
  const currentList =
    component<ComponentPropsFor<"ChatHistoryList">>("CurrentKitList");
  const controls =
    component<ComponentPropsFor<"MessageControls">>("KitControls");

  const kit = (
    builtAgainstSharedSurfaceMinor: number | undefined,
  ): ComponentKitRegistration => ({
    name: "acme",
    components: [
      { extensionPoint: "ChatHistoryList", component: list, priority: 50 },
      { extensionPoint: "MessageControls", component: controls, priority: 50 },
    ],
    ...(builtAgainstSharedSurfaceMinor === undefined
      ? {}
      : { builtAgainstSharedSurfaceMinor }),
  });

  const applyKits = async (
    kits: ComponentKitRegistration[],
    stance?: ComponentKitVersionStance,
  ) => {
    const registry = await loadRegistry();
    window.ERATO_COMPONENT_KITS = kits;
    if (stance) {
      window.ERATO_COMPONENT_KIT_VERSION_STANCE = stance;
    }
    registry.applyComponentKitRegistrations();
    return registry.componentRegistry;
  };

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    delete window.ERATO_COMPONENT_KITS;
    delete window.ERATO_COMPONENT_KIT_VERSION_STANCE;
    vi.resetModules();
  });

  it("requires no more than the host ships", () => {
    const beyondHost = Object.entries(
      EXTENSION_POINT_REQUIRED_SURFACE_MINOR,
    ).filter(([, minor]) => minor > ERATO_SHARED_SURFACE_MINOR);

    expect(beyondHost).toEqual([]);
  });

  it("names the kit, the point and what to declare when a kit declares nothing", async () => {
    await applyKits([kit(undefined)], "enforce");

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`component kit "acme"`),
    );
    const [message] = consoleError.mock.calls[0] as [string];
    expect(message).toContain("ChatHistoryList");
    expect(message).toContain(`1.${REQUIRED}`);
    expect(message).toContain(
      `set builtAgainstSharedSurfaceMinor: ${ERATO_SHARED_SURFACE_MINOR}`,
    );
  });

  it("falls back to the host component for a kit that declares nothing", async () => {
    const registry = await applyKits([kit(undefined)], "enforce");

    expect(registry.ChatHistoryList).toBeNull();
  });

  it("falls back for a kit below the requirement", async () => {
    const registry = await applyKits([kit(REQUIRED - 1)], "enforce");

    expect(registry.ChatHistoryList).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`1.${REQUIRED - 1}`),
    );
  });

  it("leaves the siblings of a stale override alone", async () => {
    const registry = await applyKits([kit(undefined)], "enforce");

    expect(registry.MessageControls).toBe(controls);
  });

  it("installs an override from a kit at the requirement, silently", async () => {
    const registry = await applyKits([kit(REQUIRED)], "enforce");

    expect(registry.ChatHistoryList).toBe(list);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("installs an override from a kit above the requirement", async () => {
    const registry = await applyKits(
      [kit(ERATO_SHARED_SURFACE_MINOR)],
      "enforce",
    );

    expect(registry.ChatHistoryList).toBe(list);
  });

  it("keeps a stale override installed under the warn stance", async () => {
    const registry = await applyKits([kit(undefined)], "warn");

    expect(registry.ChatHistoryList).toBe(list);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(`this deployment's stance is "warn"`),
    );
  });

  it("warns rather than enforces by default", async () => {
    const registry = await applyKits([kit(undefined)]);

    expect(registry.ChatHistoryList).toBe(list);
  });

  it("keeps the default when the deployment sets something else", async () => {
    window.ERATO_COMPONENT_KIT_VERSION_STANCE =
      "strict" as unknown as ComponentKitVersionStance;

    const registry = await applyKits([kit(undefined)]);

    expect(registry.ChatHistoryList).toBe(list);
  });

  it("lets a registration declare its own minor without the kit's", async () => {
    const registry = await applyKits(
      [
        {
          name: "acme",
          components: [
            {
              extensionPoint: "ChatHistoryList",
              component: list,
              priority: 50,
              builtAgainstSharedSurfaceMinor: REQUIRED,
            },
            {
              extensionPoint: "MessageControls",
              component: controls,
              priority: 50,
            },
          ],
        },
      ],
      "enforce",
    );

    expect(registry.ChatHistoryList).toBe(list);
    expect(registry.MessageControls).toBe(controls);
  });

  it("lets a registration fall behind a kit that declares currency", async () => {
    const registry = await applyKits(
      [
        {
          name: "acme",
          builtAgainstSharedSurfaceMinor: ERATO_SHARED_SURFACE_MINOR,
          components: [
            {
              extensionPoint: "ChatHistoryList",
              component: list,
              priority: 50,
              builtAgainstSharedSurfaceMinor: REQUIRED - 1,
            },
          ],
        },
      ],
      "enforce",
    );

    expect(registry.ChatHistoryList).toBeNull();
  });

  it("lets a current kit take a point a stale kit is barred from", async () => {
    // Same priority, stale kit last: without the guard it would win on load order.
    const current: ComponentKitRegistration = {
      name: "current",
      components: [
        {
          extensionPoint: "ChatHistoryList",
          component: currentList,
          priority: 50,
        },
      ],
      builtAgainstSharedSurfaceMinor: REQUIRED,
    };
    const registry = await applyKits([current, kit(undefined)], "enforce");

    expect(registry.ChatHistoryList).toBe(currentList);
  });

  it("reports a kit newer than the host without dropping its overrides", async () => {
    const registry = await applyKits(
      [kit(ERATO_SHARED_SURFACE_MINOR + 1)],
      "enforce",
    );

    expect(registry.ChatHistoryList).toBe(list);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("the host is older than the kit"),
    );
  });
});
