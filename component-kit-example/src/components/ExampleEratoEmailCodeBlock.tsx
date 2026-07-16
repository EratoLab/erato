import type { EratoEmailCodeBlockProps } from "@erato/frontend/library";
import type { ReactNode } from "react";

export const ExampleEratoEmailCodeBlock = ({
  content,
}: EratoEmailCodeBlockProps): ReactNode => (
  <pre data-component-kit="example" className="erato-component-kit-example">
    {content}
  </pre>
);
