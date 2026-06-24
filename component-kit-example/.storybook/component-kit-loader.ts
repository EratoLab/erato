import type { ComponentKitRegistration } from "@erato/frontend/library";

type ComponentKitMode = "live" | "built";

declare global {
  interface ImportMetaEnv {
    readonly STORYBOOK_COMPONENT_KIT_MODE?: ComponentKitMode;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    ERATO_COMPONENT_KITS?: ComponentKitRegistration[];
  }
}

const componentKitMode = import.meta.env.STORYBOOK_COMPONENT_KIT_MODE ?? "live";

const loadComponentKitModule = async () => {
  if (componentKitMode === "built") {
    await import("virtual:component-kit-built-style");
    await import("virtual:component-kit-built-entry");
    return;
  }

  await import("../src/style.css");
  await import("../src/index");
};

export const loadExampleComponentKit =
  async (): Promise<ComponentKitRegistration> => {
    await loadComponentKitModule();

    const componentKit = window.ERATO_COMPONENT_KITS?.findLast(
      (registration) => registration.name === "example",
    );

    if (!componentKit) {
      throw new Error("Example component kit was not registered");
    }

    return componentKit;
  };

export const storybookComponentKitMode = componentKitMode;
