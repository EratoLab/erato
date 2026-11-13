import { describe, expect, it } from "vitest";

import { appendBlockToDraft, formatMarkdownQuote } from "./markdownQuote";

describe("formatMarkdownQuote", () => {
  it("puts the quote marker in front of every line", () => {
    expect(formatMarkdownQuote("first line\nsecond line")).toBe(
      "> first line\n> second line",
    );
  });

  it("turns a paragraph break into a line holding only the marker", () => {
    expect(
      formatMarkdownQuote("\nFirst paragraph.\n\n\nSecond paragraph.\n\n"),
    ).toBe("> First paragraph.\n>\n> Second paragraph.");
  });

  it("keeps marked code as a fenced block inside the quote", () => {
    expect(
      formatMarkdownQuote("if (a) {\n\n  b();\n}", {
        code: true,
        codeLanguage: "ts",
      }),
    ).toBe("> ```ts\n> if (a) {\n>\n>   b();\n> }\n> ```");
  });
});

describe("appendBlockToDraft", () => {
  it("leaves an empty line for the cursor after the block in an empty draft", () => {
    expect(appendBlockToDraft("", "> quote")).toBe("> quote\n\n");
  });

  it("keeps the typed text and appends the block after an empty line", () => {
    expect(appendBlockToDraft("I have a question:", "> quote")).toBe(
      "I have a question:\n\n> quote\n\n",
    );
  });

  it("appends each further block the same way", () => {
    const once = appendBlockToDraft("Typed. ", "> one");
    expect(appendBlockToDraft(once, "> two\n>\n> three")).toBe(
      "Typed.\n\n> one\n\n> two\n>\n> three\n\n",
    );
  });
});
