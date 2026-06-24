import hostReact from "./react";

import type { ReactNode } from "react";

type CreatePortal = (
  children: ReactNode,
  container: Element | DocumentFragment,
  key?: null | string,
) => ReactNode;

const createPortal = hostReact.createPortal as CreatePortal | undefined;

if (!createPortal) {
  throw new Error(
    "ERATO_REACT.createPortal is not available for component kits",
  );
}

const reactDomRuntime: { createPortal: CreatePortal } = {
  createPortal,
};

export default reactDomRuntime;
export { createPortal };
