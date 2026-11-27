import { afterEach, describe, expect, it, vi } from "vitest";

import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import { playHaptic } from "./shellHaptics";

describe("playHaptic", () => {
  afterEach(() => removeHostShell());

  it("asks a host that offers haptics", () => {
    const request = installHostShell({ haptics: 1 });
    playHaptic("success");
    expect(request).toHaveBeenCalledWith("haptics.play", { kind: "success" });
  });

  it("does nothing without the capability or the host", () => {
    const request = installHostShell({ shareSheet: 1 });
    playHaptic("light");
    expect(request).not.toHaveBeenCalled();
    removeHostShell();
    expect(() => playHaptic("light")).not.toThrow();
  });

  it("swallows a refusal and a request that throws", async () => {
    installHostShell(
      { haptics: 1 },
      vi.fn(() => Promise.reject({ code: "invalidParams", message: "" })),
    );
    expect(() => playHaptic("warning")).not.toThrow();
    // Lets the rejection settle, so an unhandled one fails the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    installHostShell(
      { haptics: 1 },
      vi.fn(() => {
        throw new Error("bridge gone");
      }),
    );
    expect(() => playHaptic("light")).not.toThrow();
  });
});
