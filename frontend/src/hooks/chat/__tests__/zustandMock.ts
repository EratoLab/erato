import { act } from "@testing-library/react";
import { afterEach } from "vitest";

// Create a function that returns a mocked Zustand
function createZustandMock() {
  // Import Zustand dynamically to avoid hoisting issues
  const zustand = require("zustand");

  // A set to track all store reset functions
  const storeResetFns = new Set<() => void>();

  // Replace Zustand's create with our own version that tracks stores for reset
  const createImpl = zustand.create;
  const create = ((stateCreator: unknown) => {
    const store = createImpl(stateCreator);
    const initialState = store.getState();
    storeResetFns.add(() => {
      store.setState(initialState, true);
    });
    return store;
  }) as typeof zustand.create;

  // Reset all stores after each test
  afterEach(() => {
    act(() => {
      storeResetFns.forEach((resetFn) => {
        resetFn();
      });
    });
  });

  // Return patched version of Zustand
  return {
    ...zustand,
    create,
  };
}

export default createZustandMock();
