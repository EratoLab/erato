import { describe, expect, it } from "vitest";

import { parseReasoningSegments } from "./useReasoningSegments";

describe("parseReasoningSegments", () => {
  it("returns an empty array for blank input", () => {
    expect(parseReasoningSegments("")).toEqual([]);
    expect(parseReasoningSegments("   \n\n  ")).toEqual([]);
  });

  it("yields one segment with auto-title when no headers are present", () => {
    const text =
      "The user is asking me to analyze the website. Let me think through the key insights.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe(
      "The user is asking me to analyze the website.",
    );
    expect(segments[0].body).toBe(text);
  });

  it("truncates long auto-titles at a word boundary with an ellipsis", () => {
    const text =
      "The user is asking me to perform an extremely detailed analysis of an enormous corpus of text and surface the most relevant insights — and that prose is going to keep going for a while still.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].title.endsWith("…")).toBe(true);
    expect(segments[0].title.length).toBeLessThanOrEqual(80);
    expect(segments[0].title).not.toContain("  ");
  });

  it("treats `**Header**\\n\\n<body>` as a single titled segment", () => {
    const text =
      "**Breaking down digit constraints**\n\nI need to follow the user's request.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      title: "Breaking down digit constraints",
      body: "I need to follow the user's request.",
    });
  });

  it("splits a glued `body.**Next Header**\\n\\n<body>` into two segments", () => {
    const text =
      "**Breaking down digit constraints**\n\nI'll reason through cases to find a combination that satisfies all these conditions.**Finalizing digit configuration**\n\nI need to narrow things down.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      title: "Breaking down digit constraints",
      body: "I'll reason through cases to find a combination that satisfies all these conditions.",
    });
    expect(segments[1]).toEqual({
      title: "Finalizing digit configuration",
      body: "I need to narrow things down.",
    });
  });

  it("does NOT split on bolded list-item labels (followed by single \\n + indent)", () => {
    const text =
      "Let me think through the key insights:\n\n1. **Fashion Trends and What's Valued:**\n   - The dominance of \"Quiet Luxury\" suggests a mature market\n2. **Diversity and Individualism:**\n   - The wide range of trends suggests the market isn't monolithic";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].title).toBe("Let me think through the key insights:");
    expect(segments[0].body).toBe(text);
  });

  it("treats a header with no body yet (streaming case) as a segment with empty body", () => {
    const text = "**Breaking down digit constraints**";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      title: "Breaking down digit constraints",
      body: "",
    });
  });

  it("treats a header followed only by trailing whitespace as a segment with empty body", () => {
    const text = "**Header**\n";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ title: "Header", body: "" });
  });

  it("ignores partial bold markers mid-stream (no closing **)", () => {
    const text = "I think this is **importan";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].body).toBe(text);
  });

  it("does NOT split on inline emphasis (closed ** but followed by punctuation/space)", () => {
    const text = "This is **important** for the answer.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(1);
    expect(segments[0].body).toBe(text);
  });

  it("yields a preamble segment when prose appears before the first header", () => {
    const text =
      "I'll start by considering the constraints.\n\n**Plan**\n\nFirst, enumerate cases.";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      title: "I'll start by considering the constraints.",
      body: "I'll start by considering the constraints.",
    });
    expect(segments[1]).toEqual({
      title: "Plan",
      body: "First, enumerate cases.",
    });
  });

  it("handles a streaming-tail header with empty body in a multi-segment trace", () => {
    const text = "**First**\n\nFirst body content.**Second**";
    const segments = parseReasoningSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({
      title: "First",
      body: "First body content.",
    });
    expect(segments[1]).toEqual({ title: "Second", body: "" });
  });
});
