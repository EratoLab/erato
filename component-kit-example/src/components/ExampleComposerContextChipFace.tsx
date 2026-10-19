import type { ComposerContextChipFaceProps } from "@erato/frontend/shared";
import type { ReactNode } from "react";

// The host draws this inside the chip's open button and keeps the (x)/(+)
// beside it, so a click on the face opens the detail and nothing here may be
// focusable or clickable.
export const ExampleComposerContextChipFace = ({
  item,
  icon,
  meta,
}: ComposerContextChipFaceProps): ReactNode => (
  <span
    data-component-kit="example"
    className="erato-component-kit-example-chip-face"
  >
    {icon}
    <span className="erato-component-kit-example-chip-label">{item.label}</span>
    {meta ? (
      <span className="erato-component-kit-example-chip-meta">{meta}</span>
    ) : null}
  </span>
);
