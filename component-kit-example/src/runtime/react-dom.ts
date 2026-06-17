import hostReact from "./react";

import type { ReactNode } from "react";

type CreatePortal = (
  children: ReactNode,
  container: Element | DocumentFragment,
  key?: null | string,
) => ReactNode;

type FlushSync = <R>(fn: () => R) => R;

const createPortal = hostReact.createPortal as CreatePortal | undefined;
const flushSync = hostReact.flushSync as FlushSync | undefined;

if (!createPortal) {
  throw new Error(
    "ERATO_REACT.createPortal is not available for component kits",
  );
}

if (!flushSync) {
  throw new Error("ERATO_REACT.flushSync is not available for component kits");
}

const reactDomRuntime: { createPortal: CreatePortal; flushSync: FlushSync } = {
  createPortal,
  flushSync,
};

export default reactDomRuntime;
export { createPortal, flushSync };
