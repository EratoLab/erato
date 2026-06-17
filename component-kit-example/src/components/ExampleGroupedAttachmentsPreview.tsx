import { h } from "../react";
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
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled || item.kind === "context"}
                  onClick={() => {
                    if (item.kind === "attachment") {
                      onRemoveFile(item.id);
                    }
                  }}
                >
                  {item.labelOverride ?? fileName(item.file)}
                </button>
              );
            }

            return <span key={item.id}>{item.label ?? item.id}</span>;
          })}
        </div>
      </section>
    ))}
  </div>
);
