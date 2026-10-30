import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  useConfirmationRegistryStore,
  useOnlyWaitingConfirmations,
} from "../confirmationRegistryStore";

describe("confirmationRegistryStore", () => {
  beforeEach(() => {
    useConfirmationRegistryStore.setState({
      pendingIdsByChatId: {},
      waitingOnlyIds: {},
    });
  });

  const store = () => useConfirmationRegistryStore.getState();

  it("reports no pending confirmation by default", () => {
    expect(store().hasPending("chat-a")).toBe(false);
    expect(store().hasPending(null)).toBe(false);
    expect(store().hasPending(undefined)).toBe(false);
  });

  it("holds while any card for the chat is registered and releases when all clear", () => {
    store().registerConfirmation("chat-a", "card-1");
    store().registerConfirmation("chat-a", "card-2");
    expect(store().hasPending("chat-a")).toBe(true);

    store().unregisterConfirmation("chat-a", "card-1");
    expect(store().hasPending("chat-a")).toBe(true);

    store().unregisterConfirmation("chat-a", "card-2");
    expect(store().hasPending("chat-a")).toBe(false);
  });

  it("isolates pending state per chat", () => {
    store().registerConfirmation("chat-a", "card-1");
    expect(store().hasPending("chat-a")).toBe(true);
    expect(store().hasPending("chat-b")).toBe(false);
  });

  it("is idempotent for repeated register/unregister", () => {
    store().registerConfirmation("chat-a", "card-1");
    store().registerConfirmation("chat-a", "card-1");
    store().unregisterConfirmation("chat-a", "card-1");
    expect(store().hasPending("chat-a")).toBe(false);
    // Unregistering an unknown id is a no-op.
    store().unregisterConfirmation("chat-a", "card-1");
    expect(store().hasPending("chat-a")).toBe(false);
  });

  it("tells a hold of waiting tasks alone from one that asks something", () => {
    const onlyWaiting = () =>
      renderHook(() => useOnlyWaitingConfirmations("chat-a")).result.current;
    expect(onlyWaiting()).toBe(false);

    store().registerConfirmation("chat-a", "card-1", { waitingOnly: true });
    expect(store().hasPending("chat-a")).toBe(true);
    expect(onlyWaiting()).toBe(true);

    store().registerConfirmation("chat-a", "card-2");
    expect(onlyWaiting()).toBe(false);

    store().unregisterConfirmation("chat-a", "card-2");
    expect(onlyWaiting()).toBe(true);

    // A waiting task that stopped on a question turns its card into one that asks.
    store().registerConfirmation("chat-a", "card-1");
    expect(onlyWaiting()).toBe(false);
    expect(store().pendingIdsByChatId["chat-a"]).toEqual(["card-1"]);

    store().unregisterConfirmation("chat-a", "card-1");
    expect(store().waitingOnlyIds).toEqual({});
  });
});
