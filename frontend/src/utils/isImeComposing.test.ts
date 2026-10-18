import { describe, expect, it } from "vitest";

import { isImeComposing } from "./isImeComposing";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

describe("isImeComposing", () => {
  it("flags a key pressed while a composition is open", () => {
    expect(
      isImeComposing(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true }),
      ),
    ).toBe(true);
  });

  it("flags WebKit's confirming Enter, which arrives after compositionend", () => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: false,
    });
    Object.defineProperty(event, "keyCode", { value: 229 });

    expect(isImeComposing(event)).toBe(true);
  });

  it("passes a plain Enter through", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    Object.defineProperty(event, "keyCode", { value: 13 });

    expect(isImeComposing(event)).toBe(false);
  });

  it("reads the native event behind a React keyboard event", () => {
    const nativeEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
    });
    const reactEvent = {
      key: "Enter",
      nativeEvent,
    } as unknown as ReactKeyboardEvent;

    expect(isImeComposing(reactEvent)).toBe(true);
    expect(
      isImeComposing({
        key: "Enter",
        nativeEvent: new KeyboardEvent("keydown", { key: "Enter" }),
      } as unknown as ReactKeyboardEvent),
    ).toBe(false);
  });
});
