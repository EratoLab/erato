import { h } from "../react";
import { kitClassName } from "./utils";

import type { FileSourceSelectorProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

export const ExampleFileSourceSelector = ({
  availableProviders,
  onSelectDisk,
  onSelectCloud,
  disabled,
  isProcessing,
  className,
}: FileSourceSelectorProps): ReactNode => (
  <div data-component-kit="example" className={kitClassName(className)}>
    <button
      type="button"
      disabled={disabled || isProcessing}
      onClick={onSelectDisk}
    >
      +
    </button>
    {availableProviders.map((provider) => (
      <button
        key={provider}
        type="button"
        disabled={disabled || isProcessing}
        onClick={() => onSelectCloud(provider)}
      >
        {provider}
      </button>
    ))}
  </div>
);
