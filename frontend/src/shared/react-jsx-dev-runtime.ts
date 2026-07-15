// @ts-nocheck -- react/jsx-dev-runtime ships CJS; explicit re-exports, see
// react.ts. This facade is primarily used by development-mode kit builds.
import * as JsxDevRuntimeNamespace from "react/jsx-dev-runtime";

const JsxDevRuntime = JsxDevRuntimeNamespace.default ?? JsxDevRuntimeNamespace;

export const Fragment = JsxDevRuntime.Fragment;
export const jsxDEV = JsxDevRuntime.jsxDEV;
