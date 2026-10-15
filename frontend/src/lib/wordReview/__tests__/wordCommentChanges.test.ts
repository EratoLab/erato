import { describe, expect, it } from "vitest";

import {
  WORD_COMMENT_OP_ACTION,
  WORD_COMMENT_OP_META,
  WORD_COMMENT_OPS,
  WORD_SUBMIT_COMMENT_CHANGES_SCHEMA,
  WORD_SUBMIT_COMMENT_CHANGES_TOOL,
  acceptedWordCommentSubmission,
  isAcceptedWordCommentSubmission,
} from "../wordCommentChanges";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const part = (overrides: Record<string, unknown> = {}) =>
  ({
    content_type: "tool_use",
    tool_name: WORD_SUBMIT_COMMENT_CHANGES_TOOL,
    tool_call_id: "call-1",
    status: "success",
    input: { changes: [] },
    output: {
      status: "success",
      result: { draft_id: "call-1", action: "word.add_comments", rows: 1 },
    },
    ...overrides,
  }) as unknown as ContentPart;

/** OpenAI strict mode: every property required, no additional properties, no oneOf/anyOf. */
function strictProblems(schema: unknown, path = "$"): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  if ("oneOf" in node || "anyOf" in node || "allOf" in node)
    problems.push(`${path}: combinator`);
  const types = ([] as unknown[]).concat(node.type ?? []);
  if (types.includes("object")) {
    const properties = Object.keys((node.properties as object) ?? {});
    if (node.additionalProperties !== false)
      problems.push(`${path}: additionalProperties`);
    const required = (node.required as string[]) ?? [];
    for (const key of properties)
      if (!required.includes(key)) problems.push(`${path}.${key}: optional`);
  }
  for (const [key, child] of Object.entries(
    (node.properties as Record<string, unknown>) ?? {},
  ))
    problems.push(...strictProblems(child, `${path}.${key}`));
  if (node.items) problems.push(...strictProblems(node.items, `${path}[]`));
  return problems;
}

describe("word comment changes", () => {
  it("gives every op an action and metadata", () => {
    for (const op of WORD_COMMENT_OPS) {
      expect(WORD_COMMENT_OP_ACTION[op]).toMatch(/^word\./);
      expect(WORD_COMMENT_OP_META[op]).toBeDefined();
    }
    expect(WORD_COMMENT_OP_META.delete).toMatchObject({
      destructive: true,
      reversible: false,
    });
  });

  it("ships a schema strict tool calling accepts", () => {
    expect(strictProblems(WORD_SUBMIT_COMMENT_CHANGES_SCHEMA)).toEqual([]);
  });

  it("recognises an accepted submission by its draft id and action", () => {
    expect(isAcceptedWordCommentSubmission(part())).toBe(true);
    expect(
      isAcceptedWordCommentSubmission(
        part({
          output: {
            status: "success",
            result: { draft_id: "other", action: "word.add_comments" },
          },
        }),
      ),
    ).toBe(false);
    expect(isAcceptedWordCommentSubmission(part({ status: "error" }))).toBe(
      false,
    );
    expect(
      isAcceptedWordCommentSubmission(
        part({ tool_name: "submit_document_plan" }),
      ),
    ).toBe(false);
  });

  it("takes a message's one accepted submission, never one of several", () => {
    expect(acceptedWordCommentSubmission([part()])).toEqual({
      toolCallId: "call-1",
      action: "word.add_comments",
    });
    expect(
      acceptedWordCommentSubmission([
        part(),
        part({
          tool_call_id: "call-2",
          output: {
            status: "success",
            result: { draft_id: "call-2", action: "word.add_comments" },
          },
        }),
      ]),
    ).toBeUndefined();
  });
});
