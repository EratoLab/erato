import { afterEach, describe, expect, it } from "vitest";

import { installHostShell, removeHostShell } from "@/test/hostShellStub";

import { markSystemGlass } from "./shellSystemGlass";

describe("markSystemGlass", () => {
  afterEach(() => {
    removeHostShell();
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
});
