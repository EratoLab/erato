import type { ComponentType, ReactNode } from "react";

type HostReact = {
  createElement: (
    type: string | ComponentType<unknown>,
    props?: Record<string, unknown> | null,
    ...children: ReactNode[]
  ) => ReactNode;
};

declare global {
  interface Window {
    ERATO_REACT?: HostReact;
  }
}

const hostReact = window.ERATO_REACT;
if (!hostReact) {
  throw new Error("ERATO_REACT is not available for component kits");
}

export const h = hostReact.createElement.bind(hostReact) as (
  type: string | ComponentType<unknown>,
  props?: Record<string, unknown> | null,
  ...children: ReactNode[]
) => ReactNode;
