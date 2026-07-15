import { kitClassName } from "./utils";

import type { StarterPromptsRendererProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

export const ExampleStarterPrompts = ({
  className,
  starterPrompts,
  onStarterPromptSelect,
}: StarterPromptsRendererProps): ReactNode => (
  <div data-component-kit="example" className={kitClassName(className)}>
    {starterPrompts.map((starterPrompt) => (
      <button
        key={starterPrompt.id}
        type="button"
        onClick={() => onStarterPromptSelect(starterPrompt)}
      >
        {starterPrompt.resolvedTitle}
      </button>
    ))}
  </div>
);
