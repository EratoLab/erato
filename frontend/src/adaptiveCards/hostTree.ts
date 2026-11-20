import { createContext } from "react";
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  DefaultEventPriority,
} from "react-reconciler/constants";

import { drainTimers } from "./polyfills";

import type { ReactNode } from "react";

/**
 * A rendered element: what React DOM would have created, kept as data so a
 * surface without a DOM can read it.
 */
export interface HostElement {
  kind: "element";
  type: string;
  props: Record<string, unknown>;
  children: HostNode[];
}

export interface HostText {
  kind: "text";
  text: string;
}

export type HostNode = HostElement | HostText;

interface HostRoot {
  children: HostNode[];
}

const append = (parent: { children: HostNode[] }, child: HostNode) => {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
  parent.children.push(child);
};

const insertBefore = (
  parent: { children: HostNode[] },
  child: HostNode,
  before: HostNode,
) => {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
  const at = parent.children.indexOf(before);
  parent.children.splice(at < 0 ? parent.children.length : at, 0, child);
};

const remove = (parent: { children: HostNode[] }, child: HostNode) => {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
};

let updatePriority: number = DefaultEventPriority;
const noop = () => undefined;

const reconciler = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  noTimeout: -1,
  createInstance: (
    type: string,
    props: Record<string, unknown>,
  ): HostElement => ({
    kind: "element",
    type,
    props,
    children: [],
  }),
  createTextInstance: (text: string): HostText => ({ kind: "text", text }),
  appendInitialChild: append,
  appendChild: append,
  appendChildToContainer: append,
  insertBefore,
  insertInContainerBefore: insertBefore,
  removeChild: remove,
  removeChildFromContainer: remove,
  clearContainer: (root: HostRoot) => {
    root.children = [];
  },
  commitUpdate: (
    instance: HostElement,
    _type: string,
    _old: unknown,
    next: Record<string, unknown>,
  ) => {
    instance.props = next;
  },
  commitTextUpdate: (instance: HostText, _old: string, next: string) => {
    instance.text = next;
  },
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  getRootHostContext: () => ({}),
  getChildHostContext: (parent: object) => parent,
  getPublicInstance: (instance: HostNode) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: noop,
  preparePortalMount: noop,
  scheduleTimeout: (run: () => void, ms?: number) => setTimeout(run, ms),
  cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  supportsMicrotasks: false,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: noop,
  afterActiveInstanceBlur: noop,
  prepareScopeUpdate: noop,
  getInstanceFromScope: () => null,
  detachDeletedInstance: noop,
  resetTextContent: noop,
  hideInstance: noop,
  hideTextInstance: noop,
  unhideInstance: noop,
  unhideTextInstance: noop,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  setCurrentUpdatePriority: (priority: number) => {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority,
  resetFormInstance: noop,
  requestPostPaintCallback: noop,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent: noop,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: noop,
  suspendInstance: noop,
  suspendOnActiveViewTransition: noop,
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  rendererPackageName: "erato-adaptive-cards",
  rendererVersion: "1",
  extraDevToolsConfig: null,
  // The reconciler's typings lag its host config; the shape above is the one
  // react-reconciler 0.33 calls.
} as never);

/** A disclosure's state as first rendered: what it said, and what it showed, closed. */
export interface Toggle {
  /** The id of the region the toggle shows and hides. */
  region: string;
  label: HostNode[];
  /** What showed beside the toggle only while it was closed. */
  hint: HostNode[];
}

export interface RenderedTree {
  root: HostNode[];
  /** Every disclosure opened to read its body, by the region it controls. */
  toggles: Map<string, Toggle>;
  errors: unknown[];
}

const elements = function* (nodes: HostNode[]): Generator<HostElement> {
  for (const node of nodes) {
    if (node.kind !== "element") continue;
    yield node;
    yield* elements(node.children);
  }
};

const closedToggles = (nodes: HostNode[]): HostElement[] =>
  [...elements(nodes)].filter(
    (element) =>
      element.props["aria-expanded"] === false &&
      typeof element.props["aria-controls"] === "string" &&
      typeof element.props.onClick === "function",
  );

/** What sits beside a toggle that is not the region it opens. */
const hintOf = (
  nodes: HostNode[],
  toggle: HostElement,
  region: string,
): HostNode[] => {
  for (const parent of elements(nodes)) {
    const index = parent.children.indexOf(toggle);
    if (index < 0) continue;
    const holdsRegion = (node: HostNode): boolean =>
      node.kind === "element" &&
      (node.props.id === region || node.children.some(holdsRegion));
    return parent.children
      .slice(index + 1)
      .filter((node) => !holdsRegion(node))
      .map((node) => structuredCopy(node));
  }
  return [];
};

const structuredCopy = (node: HostNode): HostNode =>
  node.kind === "text"
    ? { ...node }
    : {
        ...node,
        props: { ...node.props },
        children: node.children.map(structuredCopy),
      };

const MAX_OPEN_ROUNDS = 8;

/**
 * Renders `element` without a DOM. With `openAll`, every disclosure is
 * opened, round by round for those inside others, so the tree holds what a
 * reader could see after opening each; `toggles` keeps how each read closed.
 */
export const renderTree = (
  element: ReactNode,
  openAll: boolean,
): RenderedTree => {
  const container: HostRoot = { children: [] };
  const errors: unknown[] = [];
  const onError = (error: unknown) => {
    errors.push(error);
  };
  const root = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    "c",
    onError,
    onError,
    onError,
    noop,
    null,
  );
  reconciler.updateContainerSync(element, root, null, null);
  reconciler.flushSyncWork();
  drainTimers();

  const toggles = new Map<string, Toggle>();
  for (let round = 0; openAll && round < MAX_OPEN_ROUNDS; round++) {
    const closed = closedToggles(container.children).filter(
      (toggle) => !toggles.has(toggle.props["aria-controls"] as string),
    );
    if (closed.length === 0) break;
    for (const toggle of closed) {
      const region = toggle.props["aria-controls"] as string;
      toggles.set(region, {
        region,
        label: toggle.children.map(structuredCopy),
        hint: hintOf(container.children, toggle, region),
      });
    }
    for (const toggle of closed) {
      const onClick = toggle.props.onClick as (event: unknown) => void;
      reconciler.flushSyncFromReconciler(() => {
        onClick({ preventDefault: noop, stopPropagation: noop });
      });
    }
    reconciler.flushSyncWork();
    drainTimers();
  }

  const tree = container.children.map(structuredCopy);
  reconciler.updateContainerSync(null, root, null, null);
  reconciler.flushSyncWork();
  drainTimers();
  return { root: tree, toggles, errors };
};
