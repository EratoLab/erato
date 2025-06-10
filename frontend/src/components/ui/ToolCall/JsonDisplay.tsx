import clsx from "clsx";

import type React from "react";

export interface JsonDisplayProps {
  data: unknown;
  className?: string;
}

/**
 * Formats a value in a human-friendly way using theme colors
 */
const formatValue = (value: unknown, depth = 0): React.ReactNode => {
  if (value === null) return <span className="text-theme-fg-muted">null</span>;
  if (value === undefined)
    return <span className="text-theme-fg-muted">undefined</span>;

  if (typeof value === "string") {
    return <span className="text-theme-success-fg">&quot;{value}&quot;</span>;
  }

  if (typeof value === "number") {
    return <span className="text-theme-info-fg">{value}</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="text-theme-warning-fg">{value ? "true" : "false"}</span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="text-theme-fg-muted">[]</span>;

    return (
      <div>
        <span className="text-theme-fg-secondary">[</span>
        {value.map((item, index) => (
          <div key={index} className="ml-4">
            {formatValue(item, depth + 1)}
            {index < value.length - 1 && (
              <span className="text-theme-fg-muted">,</span>
            )}
          </div>
        ))}
        <span className="text-theme-fg-secondary">]</span>
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0)
      return <span className="text-theme-fg-muted">{"{}"}</span>;

    return (
      <div>
        <span className="text-theme-fg-secondary">{"{"}</span>
        {entries.map(([key, val], index) => (
          <div key={key} className="ml-4">
            <span className="font-medium text-theme-fg-accent">{key}</span>
            <span className="text-theme-fg-secondary">: </span>
            {formatValue(val, depth + 1)}
            {index < entries.length - 1 && (
              <span className="text-theme-fg-muted">,</span>
            )}
          </div>
        ))}
        <span className="text-theme-fg-secondary">{"}"}</span>
      </div>
    );
  }

  return <span className="text-theme-fg-primary">{String(value)}</span>;
};

/**
 * Component to display JSON data in a human-friendly, readable way
 */
export const JsonDisplay: React.FC<JsonDisplayProps> = ({
  data,
  className,
}) => {
  return (
    <div className={clsx("text-sm", className)}>
      <div className="relative">
        <div
          className={clsx(
            "overflow-x-auto rounded-md bg-theme-bg-hover p-3",
            "text-theme-fg-primary",
          )}
        >
          {formatValue(data)}
        </div>
      </div>
    </div>
  );
};
