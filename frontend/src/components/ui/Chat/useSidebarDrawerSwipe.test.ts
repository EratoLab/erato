import { describe, expect, it } from "vitest";

import { dragDirection, settlesOpen } from "./useSidebarDrawerSwipe";

describe("dragDirection", () => {
  it("waits until the finger has moved a little", () => {
    expect(dragDirection(4, 5)).toBeNull();
  });

  it("goes by the larger movement", () => {
    expect(dragDirection(12, 5)).toBe("horizontal");
    expect(dragDirection(-12, 5)).toBe("horizontal");
    expect(dragDirection(6, -12)).toBe("vertical");
  });
});

describe("settlesOpen", () => {
  it("goes by distance on a slow release", () => {
    expect(settlesOpen(0.4, 0)).toBe(false);
    expect(settlesOpen(0.6, 0)).toBe(true);
  });

  it("follows a flick, however short", () => {
    expect(settlesOpen(0.1, 0.5)).toBe(true);
    expect(settlesOpen(0.9, -0.5)).toBe(false);
  });

  it("does not take a slow drift for a flick", () => {
    expect(settlesOpen(0.6, -0.2)).toBe(true);
    expect(settlesOpen(0.4, 0.2)).toBe(false);
  });
});
