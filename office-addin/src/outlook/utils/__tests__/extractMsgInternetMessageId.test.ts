import { describe, expect, it } from "vitest";

import { buildCfbWith, latin1, utf16le } from "../../../test/fixtures/msg";
import {
  extractMsgInternetMessageId,
  extractMsgInternetMessageIdFromBytes,
} from "../extractMsgInternetMessageId";

describe("extractMsgInternetMessageIdFromBytes", () => {
  it("returns the Message-ID string when the stream is present", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<abc123@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<abc123@example.com>",
    );
  });

  it("strips trailing UTF-16 null padding and whitespace", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<abc@host>  \u0000\u0000"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe("<abc@host>");
  });

  it("returns null when the stream is missing", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_0037001F",
        content: utf16le("Some subject"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBeNull();
  });

  it("returns null for an empty stream", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: new Uint8Array(0),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBeNull();
  });

  it("reads the ANSI (PT_STRING8) stream when only that variant is present", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001E",
        content: latin1("<ansi-only@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<ansi-only@example.com>",
    );
  });

  it("prefers the Unicode stream when both variants are present", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001E",
        content: latin1("<ansi@example.com>"),
      },
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<unicode@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<unicode@example.com>",
    );
  });

  it("strips trailing null padding from the ANSI stream", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001E",
        content: latin1("<padded@host>  \u0000\u0000"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<padded@host>",
    );
  });

  it("ignores an embedded attachment's Message-ID when the top level has none", () => {
    // A bare stream name resolves against every leaf in the tree, so an
    // embedded forwarded message can shadow the carrier's own id.
    const cfbBytes = buildCfbWith([
      {
        name: "/__attach_version1.0_#00000000/__substg1.0_3701000D/__substg1.0_1035001F",
        content: utf16le("<embedded@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBeNull();
  });

  it("returns the top-level Message-ID even when an embedded one exists", () => {
    const cfbBytes = buildCfbWith([
      {
        name: "/__attach_version1.0_#00000000/__substg1.0_3701000D/__substg1.0_1035001F",
        content: utf16le("<embedded@example.com>"),
      },
      {
        name: "/__substg1.0_1035001F",
        content: utf16le("<carrier@example.com>"),
      },
    ]);
    expect(extractMsgInternetMessageIdFromBytes(cfbBytes)).toBe(
      "<carrier@example.com>",
    );
  });

  it("returns null for non-CFB input", () => {
    expect(
      extractMsgInternetMessageIdFromBytes(new Uint8Array([1, 2, 3, 4])),
    ).toBeNull();
  });

  it("accepts a File via the async wrapper", async () => {
    const cfbBytes = buildCfbWith([
      {
        name: "__substg1.0_1035001F",
        content: utf16le("<xyz@host>"),
      },
    ]);
    const buffer = new ArrayBuffer(cfbBytes.length);
    new Uint8Array(buffer).set(cfbBytes);
    const file = new File([buffer], "sample.msg", {
      type: "application/vnd.ms-outlook",
    });
    expect(await extractMsgInternetMessageId(file)).toBe("<xyz@host>");
  });
});
