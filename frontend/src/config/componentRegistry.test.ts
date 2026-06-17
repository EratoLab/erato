import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ComponentKitRegistration,
  ComponentRegistry,
} from "./componentRegistry";
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
