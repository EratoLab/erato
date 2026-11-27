import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import { markSystemGlass, useSystemGlass } from "./shellSystemGlass";

/** A shell whose `systemGlass.changed` listeners the test can call. */
function shellWithEvents(capabilities: Record<string, number>) {
  installHostShell(capabilities);
  const listeners: Array<(payload: unknown) => void> = [];
  window.ERATO_SHELL = {
    ...(window.ERATO_SHELL as object),
    on: (event: string, listener: (payload: unknown) => void) => {
      if (event === "systemGlass.changed") listeners.push(listener);
      return () => {};
    },
  };
  return (payload: unknown) =>
    listeners.forEach((listener) => listener(payload));
}

describe("markSystemGlass", () => {
  afterEach(() => {
    removeHostShell();
    markSystemGlass(document.documentElement);
  });

  it("marks the page inside an app that offers systemGlass", () => {
    installHostShell({ systemGlass: 1 });
    const root = document.createElement("html");
    markSystemGlass(root);
    expect(root.hasAttribute("data-system-glass")).toBe(true);
  });

  it("leaves a browser and an app without the capability unmarked", () => {
    const root = document.createElement("html");
    root.setAttribute("data-system-glass", "");
    markSystemGlass(root);
    expect(root.hasAttribute("data-system-glass")).toBe(false);

    installHostShell({ share: 1 });
    markSystemGlass(root);
    expect(root.hasAttribute("data-system-glass")).toBe(false);
  });

  it("follows the app's answer when the setting changes while it runs", () => {
    const send = shellWithEvents({ share: 1 });
    const root = document.createElement("html");
    markSystemGlass(root);
    const { result } = renderHook(() => useSystemGlass());
    expect(result.current).toBe(false);

    act(() => send({ available: true }));
    expect(root.hasAttribute("data-system-glass")).toBe(true);
    expect(result.current).toBe(true);

    act(() => send({ available: false }));
    expect(root.hasAttribute("data-system-glass")).toBe(false);
    expect(result.current).toBe(false);

    act(() => send({ available: "yes" }));
    expect(result.current).toBe(false);
  });
});
