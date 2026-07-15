// @ts-nocheck -- react-dom ships CJS; explicit re-exports, see react.ts.
// Import-map expose entry: re-exports the add-in-bundle module instance (keep in sync with frontend/src/shared).
// Kits resolve this specifier via the server-emitted import map — do not
// import this file from app code.
import * as ReactDomNamespace from "react-dom";

const ReactDom = ReactDomNamespace.default ?? ReactDomNamespace;

export default ReactDom;

export const createPortal = ReactDom.createPortal;
export const flushSync = ReactDom.flushSync;
export const preconnect = ReactDom.preconnect;
export const prefetchDNS = ReactDom.prefetchDNS;
export const preinit = ReactDom.preinit;
export const preload = ReactDom.preload;
export const requestFormReset = ReactDom.requestFormReset;
export const useFormStatus = ReactDom.useFormStatus;
export const version = ReactDom.version;
