import { fileName, kitClassName } from "./utils";

import type { GroupedFileAttachmentsPreviewProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

export const ExampleGroupedAttachmentsPreview = ({
  groups,
  onRemoveFile,
  disabled,
  className,
}: GroupedFileAttachmentsPreviewProps): ReactNode => (
  <div data-component-kit="example" className={kitClassName(className)}>
    {groups.map((group) => (
      <section key={group.id}>
        <strong>{group.label}</strong>
        <div className="erato-component-kit-example-files">
          {group.items.map((item) => {
            if ("file" in item) {
              // Removal is offered only where the host supplied a handler:
              // a sent message has nothing to remove, and a control that
              // cannot act reads as broken.
              const removable =
                onRemoveFile !== undefined && item.kind === "attachment";

              return removable ? (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemoveFile(item.id)}
                >
                  {item.labelOverride ?? fileName(item.file)}
                </button>
              ) : (
                <span key={item.id}>
                  {item.labelOverride ?? fileName(item.file)}
                </span>
              );
            }

            return <span key={item.id}>{item.label ?? item.id}</span>;
          })}
        </div>
      </section>
    ))}
  </div>
);
