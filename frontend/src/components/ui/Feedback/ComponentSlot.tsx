import { createElement } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { componentRegistry } from "@/config/componentRegistry";

import type { ComponentRegistry } from "@/config/componentRegistry";
import type { ComponentProps, ComponentType } from "react";

type ExtensionPointProps<TPoint extends keyof ComponentRegistry> =
  ComponentProps<Exclude<ComponentRegistry[TPoint], null>>;

export interface ComponentSlotProps<TPoint extends keyof ComponentRegistry> {
  /** The extension point a kit's override is registered under. */
  extensionPoint: TPoint;
  /** The host's own component, rendered when there is no override. */
  fallback: ComponentType<ExtensionPointProps<TPoint>>;
  slotProps: ExtensionPointProps<TPoint>;
}

/**
 * Renders an extension point: the kit's override when there is one, and the
 * host's own component when there is none or the override throws. Use it
 * where a broken kit must not take the surface down with it.
 */
export function ComponentSlot<TPoint extends keyof ComponentRegistry>({
  extensionPoint,
  fallback,
  slotProps,
}: ComponentSlotProps<TPoint>) {
  // The signature ties the three together for callers; inside, TypeScript
  // cannot resolve the props of a point that is still generic.
  const own = createElement(fallback as ComponentType<object>, slotProps);
  const override = componentRegistry[
    extensionPoint
  ] as ComponentType<object> | null;
  if (!override) {
    return own;
  }
  return (
    <ErrorBoundary
      fallback={own}
      onError={(error) => {
        console.error(
          `component kit override of ${extensionPoint} failed; rendering the host's own`,
          error,
        );
      }}
    >
      {createElement(override, slotProps)}
    </ErrorBoundary>
  );
}
