import type { ReactNode } from "react";

declare global {
  namespace JSX {
    type Element = ReactNode;
    interface IntrinsicElements {
      [elementName: string]: unknown;
    }
  }
}
