import type * as ReactModule from "react";

declare global {
  interface Window {
    ERATO_REACT?: typeof ReactModule & {
      createPortal?: unknown;
    };
  }
}

const hostReactRuntime = window.ERATO_REACT;
if (!hostReactRuntime) {
  throw new Error("ERATO_REACT is not available for component kits");
}

const hostReact = hostReactRuntime;

export default hostReact;

export const Children: typeof ReactModule.Children = hostReact.Children;
export const Component: typeof ReactModule.Component = hostReact.Component;
export const Fragment: typeof ReactModule.Fragment = hostReact.Fragment;
export const Profiler: typeof ReactModule.Profiler = hostReact.Profiler;
export const PureComponent: typeof ReactModule.PureComponent =
  hostReact.PureComponent;
export const StrictMode: typeof ReactModule.StrictMode = hostReact.StrictMode;
export const Suspense: typeof ReactModule.Suspense = hostReact.Suspense;
export const cloneElement: typeof ReactModule.cloneElement =
  hostReact.cloneElement;
export const createContext: typeof ReactModule.createContext =
  hostReact.createContext;
export const createElement: typeof ReactModule.createElement =
  hostReact.createElement;
export const createRef: typeof ReactModule.createRef = hostReact.createRef;
export const forwardRef: typeof ReactModule.forwardRef = hostReact.forwardRef;
export const isValidElement: typeof ReactModule.isValidElement =
  hostReact.isValidElement;
export const lazy: typeof ReactModule.lazy = hostReact.lazy;
export const memo: typeof ReactModule.memo = hostReact.memo;
export const startTransition: typeof ReactModule.startTransition =
  hostReact.startTransition;
export const use: typeof ReactModule.use = hostReact.use;
export const useActionState: typeof ReactModule.useActionState =
  hostReact.useActionState;
export const useCallback: typeof ReactModule.useCallback =
  hostReact.useCallback;
export const useContext: typeof ReactModule.useContext = hostReact.useContext;
export const useDebugValue: typeof ReactModule.useDebugValue =
  hostReact.useDebugValue;
export const useDeferredValue: typeof ReactModule.useDeferredValue =
  hostReact.useDeferredValue;
export const useEffect: typeof ReactModule.useEffect = hostReact.useEffect;
export const useEffectEvent: typeof ReactModule.useEffectEvent =
  hostReact.useEffectEvent;
export const useId: typeof ReactModule.useId = hostReact.useId;
export const useImperativeHandle: typeof ReactModule.useImperativeHandle =
  hostReact.useImperativeHandle;
export const useInsertionEffect: typeof ReactModule.useInsertionEffect =
  hostReact.useInsertionEffect;
export const useLayoutEffect: typeof ReactModule.useLayoutEffect =
  hostReact.useLayoutEffect;
export const useMemo: typeof ReactModule.useMemo = hostReact.useMemo;
export const useOptimistic: typeof ReactModule.useOptimistic =
  hostReact.useOptimistic;
export const useReducer: typeof ReactModule.useReducer = hostReact.useReducer;
export const useRef: typeof ReactModule.useRef = hostReact.useRef;
export const useState: typeof ReactModule.useState = hostReact.useState;
export const useSyncExternalStore: typeof ReactModule.useSyncExternalStore =
  hostReact.useSyncExternalStore;
export const useTransition: typeof ReactModule.useTransition =
  hostReact.useTransition;
export const version: typeof ReactModule.version = hostReact.version;
