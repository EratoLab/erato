import { act } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import type * as ZustandExportedTypes from "zustand";

const { create: actualCreate, createStore: actualCreateStore } =
  await vi.importActual<typeof ZustandExportedTypes>("zustand");

// a variable to hold reset functions for all stores declared in the app
export const storeResetFns = new Set<() => void>();

const createUncurried = <T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  const store = actualCreate(stateCreator);
  const initialState = store.getInitialState() ?? store.getState();
  storeResetFns.add(() => {
    store.setState(initialState, true);
  });
  return store;
};

// when creating a store, we get its initial state, create a reset function and add it in the set
export const create = (<T>(
  stateCreator?: ZustandExportedTypes.StateCreator<T>,
) => {
  // to support curried version of create
  if (typeof stateCreator === "function") {
    return createUncurried(stateCreator);
  }

  // return function for curried usage: create<T>()(...args)
  return createUncurried;
}) as typeof ZustandExportedTypes.create;

const createStoreUncurried = <T>(
  stateCreator: ZustandExportedTypes.StateCreator<T>,
) => {
  const store = actualCreateStore(stateCreator);
  const initialState = store.getInitialState() ?? store.getState();
  storeResetFns.add(() => {
    store.setState(initialState, true);
  });
  return store;
};

// when creating a store, we get its initial state, create a reset function and add it in the set
export const createStore = (<T>(
  stateCreator?: ZustandExportedTypes.StateCreator<T>,
) => {
  // to support curried version of createStore
  if (typeof stateCreator === "function") {
    return createStoreUncurried(stateCreator);
  }

  // return function for curried usage: createStore<T>()(...args)
  return createStoreUncurried;
}) as typeof ZustandExportedTypes.createStore;

// reset all stores after each test run
afterEach(() => {
  act(() => {
    storeResetFns.forEach((resetFn) => {
      resetFn();
    });
  });
});

// Export all other Zustand exports
export * from "zustand";
