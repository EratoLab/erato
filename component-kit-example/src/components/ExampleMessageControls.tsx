import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleMessageControls: NonNullable<
  ComponentRegistry["MessageControls"]
> = ({ messageId, onAction, className }) => (
  <div data-component-kit="example" className={kitClassName(className)}>
    <button
      type="button"
      onClick={() => void onAction({ type: "copy", messageId })}
    >
      copy
    </button>
  </div>
);
