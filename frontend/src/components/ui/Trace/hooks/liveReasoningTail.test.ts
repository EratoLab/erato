import { describe, expect, it } from "vitest";

import { liveReasoningTail } from "./liveReasoningTail";

const paragraph = (i: number) =>
  `Paragraph ${i} weighs the options once more and keeps the cheaper one.`;

const paragraphs = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => paragraph(from + i)).join("\n\n");

describe("liveReasoningTail", () => {
  it("returns a short section unchanged", () => {
    const text = paragraphs(20);
    expect(liveReasoningTail(text)).toBe(text);
  });

  it("starts a long section's tail at a paragraph and keeps its end", () => {
    const text = paragraphs(400);
    const tail = liveReasoningTail(text);

    expect(tail.length).toBeGreaterThanOrEqual(4_000);
    expect(tail.length).toBeLessThanOrEqual(6_000);
    expect(tail).toMatch(/^Paragraph \d+ /);
    expect(text.endsWith(tail)).toBe(true);
  });

  it("reopens a code block the cut lands in", () => {
    const code = Array.from(
      { length: 300 },
      (_, i) => `const value${i} = compute(${i});\n\nlog(value${i});`,
    ).join("\n\n");
    const text = `${paragraphs(10)}\n\n\`\`\`ts\n${code}\n\`\`\`\n\nDone.`;
    const tail = liveReasoningTail(text);

    expect(tail.startsWith("```ts\n")).toBe(true);
    expect(tail.endsWith("```\n\nDone.")).toBe(true);
  });

  it("does not reopen a code block that closed before the cut", () => {
    const text = `\`\`\`ts\nconst a = 1;\n\`\`\`\n\n${paragraphs(400)}`;
    expect(liveReasoningTail(text)).toMatch(/^Paragraph \d+ /);
  });

  it("does not start the tail on an indented continuation line", () => {
    const nested = Array.from(
      { length: 300 },
      (_, i) => `- item ${i}\n\n    continued detail for item ${i}`,
    ).join("\n\n");
    const tail = liveReasoningTail(nested);
    expect(tail.startsWith("- item ")).toBe(true);
  });

  it("renders the whole section when it has no paragraph to start from", () => {
    const text = "word ".repeat(2_000);
    expect(liveReasoningTail(text)).toBe(text);
  });
});
