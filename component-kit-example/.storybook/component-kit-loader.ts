import type { ComponentKitRegistration } from "@erato/frontend/library";
import { loadComponentKitModule } from "virtual:component-kit-mode-loader";

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
