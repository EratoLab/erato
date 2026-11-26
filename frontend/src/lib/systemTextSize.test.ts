import { describe, expect, it, vi } from "vitest";

import { systemTextScale } from "./systemTextSize";

describe("systemTextScale", () => {
  it("is null where the engine has no system body font", () => {
    expect(systemTextScale()).toBeNull();
  });

  it("divides the system body size by the default 17 px", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      CSSStyleDeclaration.prototype,
      "font",
    );
    const fonts = new WeakMap<CSSStyleDeclaration, string>();
    Object.defineProperty(CSSStyleDeclaration.prototype, "font", {
      configurable: true,
      get(this: CSSStyleDeclaration) {
        return fonts.get(this) ?? "";
      },
      set(this: CSSStyleDeclaration, value: string) {
        fonts.set(this, value);
      },
    });
    const computed = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({ fontSize: "21px" } as CSSStyleDeclaration);

    try {
      expect(systemTextScale()).toBe(21 / 17);
    } finally {
      computed.mockRestore();
      if (descriptor) {
        Object.defineProperty(
          CSSStyleDeclaration.prototype,
          "font",
          descriptor,
        );
      } else {
        delete (CSSStyleDeclaration.prototype as { font?: string }).font;
      }
    }
  });
});
