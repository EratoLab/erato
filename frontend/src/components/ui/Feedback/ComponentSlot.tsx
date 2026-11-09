import { createElement } from "react";
import { ErrorBoundary } from "react-error-boundary";

import type { ComponentType } from "react";

export interface ComponentSlotProps<TProps extends object> {
  /** The registered override, if a component kit provides one. */
  override: ComponentType<TProps> | null | undefined;
  /** The host's own component, rendered when there is no override. */
  fallback: ComponentType<TProps>;
  slotProps: TProps;
  /** The extension point, for the log line. */
  name: string;
}

/**
 * Renders an extension point: the kit's override when there is one, and the
 * host's own component when there is none or the override throws. Use it
 * where a broken kit must not take the surface down with it.
 */
export function ComponentSlot<TProps extends object>({
  override,
  fallback,
  slotProps,
  name,
}: ComponentSlotProps<TProps>) {
  const own = createElement(fallback, slotProps);
  if (!override) {
    return own;
  }
  return (
    <ErrorBoundary
      fallback={own}
      onError={(error) => {
        console.error(
          `component kit override of ${name} failed; rendering the host's own`,
          error,
        );
      }}
    >
      {createElement(override, slotProps)}
    </ErrorBoundary>
  );
}
