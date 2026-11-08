import clsx from "clsx";

import type React from "react";

export interface DetailField {
  key?: string;
  label: string;
  value: React.ReactNode;
}

export type DetailFieldsLayout = "grid" | "stacked";

export interface DetailFieldsProps {
  /** Rendered in order; an empty list renders nothing. Leave out empty values. */
  fields: readonly DetailField[];
  /** `grid`: the label column is as wide as the widest label. */
  layout?: DetailFieldsLayout;
  size?: "xs" | "sm";
  labelTone?: "muted" | "secondary";
  className?: string;
  /** Theme hook. Defaults to `detail-fields`. */
  "data-ui"?: string;
}

/** Label/value pairs as a description list. */
export function DetailFields({
  fields,
  layout = "grid",
  size = "sm",
  labelTone = "muted",
  className,
  "data-ui": dataUi,
}: DetailFieldsProps) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <dl
      data-ui={dataUi ?? "detail-fields"}
      data-layout={layout}
      className={clsx(
        layout === "grid"
          ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"
          : "flex flex-col gap-2",
        size === "xs" ? "text-xs" : "text-sm",
        className,
      )}
    >
      {fields.map((field) => (
        <div
          key={field.key ?? field.label}
          className={layout === "grid" ? "contents" : "min-w-0"}
        >
          <dt
            className={
              labelTone === "muted"
                ? "text-theme-fg-muted"
                : "text-theme-fg-secondary"
            }
          >
            {field.label}
          </dt>
          <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
