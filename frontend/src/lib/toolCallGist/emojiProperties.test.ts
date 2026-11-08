import { describe, expect, it } from "vitest";

import { isEmoji, isExtendedPictographic } from "./emojiProperties";

const hex = (code: number) => `U+${code.toString(16).toUpperCase()}`;

describe("emoji properties", () => {
  it("reads Emoji as Unicode 16 has it, at the table's edges too", () => {
    for (const [code, expected] of [
      [0x0022, false],
      [0x0023, true],
      [0x0030, true],
      [0x0039, true],
      [0x003a, false],
      [0x0061, false],
      [0x00a9, true],
      [0x2764, true],
      [0xfe0f, false],
      [0x1f000, false],
      [0x1f3fd, true],
      [0x1f600, true],
      [0x1f6d8, false],
      [0x1faf8, true],
      [0x1faf9, false],
    ] as const) {
      expect(isEmoji(code), hex(code)).toBe(expected);
    }
  });

  it("reads Extended_Pictographic as Unicode 16 has it, at the table's edges too", () => {
    for (const [code, expected] of [
      [0x0023, false],
      [0x00a8, false],
      [0x00a9, true],
      [0x2605, true],
      [0x2764, true],
      [0x1f000, true],
      [0x1f1ea, false],
      [0x1f3fd, false],
      [0x1f468, true],
      [0x1fffd, true],
      [0x1fffe, false],
    ] as const) {
      expect(isExtendedPictographic(code), hex(code)).toBe(expected);
    }
  });
});
