import hostReact, { Fragment } from "./react";

import type * as ReactJsxRuntime from "react/jsx-runtime";
import type { ElementType, Key } from "react";

const createJsxElement = (
  type: ElementType,
  props: Record<string, unknown> | null,
  key?: Key,
) =>
  hostReact.createElement(type, key === undefined ? props : { ...props, key });

export const jsx = createJsxElement as typeof ReactJsxRuntime.jsx;
export const jsxs = createJsxElement as typeof ReactJsxRuntime.jsxs;
export const jsxDEV = createJsxElement as typeof ReactJsxRuntime.jsx;
export { Fragment };
