import { ReadAloudButton } from "@erato/frontend/shared";

import { kitClassName } from "./utils";

import type { ComponentRegistry } from "@erato/frontend/library";

export const ExampleMessageControls: NonNullable<
  ComponentRegistry["MessageControls"]
> = ({ messageId, onAction, className, showOnHover, readAloud }) => (
  <div data-component-kit="example" className={kitClassName(className)}>
    <button
      type="button"
      onClick={() => void onAction({ type: "copy", messageId })}
    >
      copy
    </button>
    {/* Custom controls show the host's read aloud button only if they render
        it. It decides by itself when to appear; pass the props through. */}
    <ReadAloudButton
      messageId={messageId}
      showOnHover={showOnHover}
      readAloud={readAloud}
    />
  </div>
);
