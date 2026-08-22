import { beforeEach, describe, expect, it } from "vitest";

import {
  holdSessionPolicy,
  isSessionPolicyHeld,
  releaseSessionPolicy,
  subscribeSessionPolicyGate,
} from "../policyGate";

describe("policyGate", () => {
  beforeEach(() => {
    while (isSessionPolicyHeld()) {
      releaseSessionPolicy();
    }
  });

  it("counts holds so independent holders cannot release each other", () => {
    expect(isSessionPolicyHeld()).toBe(false);

    holdSessionPolicy();
    holdSessionPolicy();
    releaseSessionPolicy();
    expect(isSessionPolicyHeld()).toBe(true);

    releaseSessionPolicy();
    expect(isSessionPolicyHeld()).toBe(false);
  });

  it("survives an unbalanced release without going negative", () => {
    releaseSessionPolicy();
    expect(isSessionPolicyHeld()).toBe(false);

    holdSessionPolicy();
    expect(isSessionPolicyHeld()).toBe(true);
    releaseSessionPolicy();
  });

  it("notifies subscribers on transitions and stops after unsubscribe", () => {
    const observed: boolean[] = [];
    const unsubscribe = subscribeSessionPolicyGate(() => {
      observed.push(isSessionPolicyHeld());
    });

    holdSessionPolicy();
    releaseSessionPolicy();
    unsubscribe();
    holdSessionPolicy();
    releaseSessionPolicy();

    expect(observed).toEqual([true, false]);
  });
});
