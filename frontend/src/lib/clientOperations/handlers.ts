import type { ClientOperationHandler } from "./coordinator";

/** Handlers a shell registers beside a coordinator's built-ins. The registrant
 * owns them: they are stateless across accounts and never disposed by a
 * coordinator. */
export interface ClientOperationHandlerRegistry {
  register(handler: ClientOperationHandler): () => void;
  handlers(): readonly ClientOperationHandler[];
  subscribe(listener: () => void): () => void;
  /** Asks every subscribed coordinator for an immediate sweep. */
  nudge(): void;
}

export function createClientOperationHandlerRegistry(): ClientOperationHandlerRegistry {
  const registered = new Set<ClientOperationHandler>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    register(handler) {
      registered.add(handler);
      notify();
      return () => {
        registered.delete(handler);
      };
    },
    handlers: () => [...registered],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    nudge: notify,
  };
}

export const clientOperationHandlerRegistry =
  createClientOperationHandlerRegistry();

export const registerClientOperationHandler = (
  handler: ClientOperationHandler,
): (() => void) => clientOperationHandlerRegistry.register(handler);

export const requestClientOperationSweep = (): void => {
  clientOperationHandlerRegistry.nudge();
};
