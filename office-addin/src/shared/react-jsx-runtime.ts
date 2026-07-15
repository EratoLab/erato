// @ts-nocheck -- react/jsx-runtime ships CJS; explicit re-exports, see react.ts.
// Import-map expose entry: re-exports the add-in-bundle module instance (keep in sync with frontend/src/shared).
// Kits resolve this specifier via the server-emitted import map — do not
// import this file from app code.
import * as JsxRuntimeNamespace from "react/jsx-runtime";

const JsxRuntime = JsxRuntimeNamespace.default ?? JsxRuntimeNamespace;

export const Fragment = JsxRuntime.Fragment;
export const jsx = JsxRuntime.jsx;
export const jsxs = JsxRuntime.jsxs;
