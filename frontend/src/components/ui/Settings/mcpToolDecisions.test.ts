import { describe, expect, it } from "vitest";

import {
  groupChoiceChanges,
  groupCommonDecision,
  offeredDecisions,
  planDecisionChanges,
  storedDecisionFor,
} from "./mcpToolDecisions";

import type { McpServerTool } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const tool = (overrides: Partial<McpServerTool>): McpServerTool => ({
  name: "get_issue",
  title: "Get issue",
  description: null,
  description_truncated: false,
  annotations: {
    read_only_hint: true,
    destructive_hint: false,
    idempotent_hint: true,
    open_world_hint: false,
    annotated: true,
  },
  policy: "ask",
  user_decision: "none",
  effective: "ask",
  is_wait_tool: false,
  ...overrides,
});

const all = { allowAlways: true, askAvailable: true };
const none = { allowAlways: false, askAvailable: false };

describe("offeredDecisions", () => {
  it("always offers the policy default and Never, the rest by availability", () => {
    expect(offeredDecisions("ask", all)).toEqual(["allow", "ask", "never"]);
    expect(offeredDecisions("ask", none)).toEqual(["ask", "never"]);
    expect(offeredDecisions("auto", all)).toEqual(["allow", "ask", "never"]);
    expect(offeredDecisions("auto", none)).toEqual(["allow", "never"]);
    // Each flag only unlocks the option it stands for.
    expect(
      offeredDecisions("ask", { allowAlways: false, askAvailable: true }),
    ).toEqual(["ask", "never"]);
    expect(
      offeredDecisions("auto", { allowAlways: true, askAvailable: false }),
    ).toEqual(["allow", "never"]);
  });
});

describe("storedDecisionFor", () => {
  it("clears the row for the policy default and stores the rest by availability", () => {
    expect(storedDecisionFor({ policy: "ask" }, "ask", none)).toBeNull();
    expect(storedDecisionFor({ policy: "auto" }, "allow", none)).toBeNull();
    expect(storedDecisionFor({ policy: "ask" }, "never", none)).toBe("denied");
    expect(storedDecisionFor({ policy: "ask" }, "allow", all)).toBe(
      "always_allow",
    );
    expect(storedDecisionFor({ policy: "ask" }, "allow", none)).toBeUndefined();
    expect(storedDecisionFor({ policy: "auto" }, "ask", all)).toBe("ask");
    expect(storedDecisionFor({ policy: "auto" }, "ask", none)).toBeUndefined();
  });
});

describe("planDecisionChanges", () => {
  const asking = tool({ name: "get_issue", policy: "ask", effective: "ask" });
  const unprompted = tool({
    name: "list_teams",
    policy: "auto",
    effective: "allow",
  });

  it("sends one entry per tool that changes, projected to its new state", () => {
    const plan = planDecisionChanges(
      [
        { tool: asking, next: "allow" },
        { tool: unprompted, next: "allow" },
      ],
      all,
    );

    // The unprompted tool already allows: nothing to send, nothing skipped.
    expect(plan.entries).toEqual([
      { tool_name: "get_issue", decision: "always_allow" },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.projected.get("get_issue")).toMatchObject({
      user_decision: "always_allow",
      effective: "allow",
    });
    expect(plan.projected.has("list_teams")).toBe(false);
  });

  it("maps the policy default to a null entry and Never to denied", () => {
    const plan = planDecisionChanges(
      [
        {
          tool: tool({
            name: "get_issue",
            policy: "ask",
            user_decision: "denied",
            effective: "denied",
          }),
          next: "ask",
        },
        { tool: unprompted, next: "never" },
      ],
      none,
    );

    expect(plan.entries).toEqual([
      { tool_name: "get_issue", decision: null },
      { tool_name: "list_teams", decision: "denied" },
    ]);
    expect(plan.projected.get("get_issue")).toMatchObject({
      user_decision: "none",
      effective: "ask",
    });
    expect(plan.projected.get("list_teams")).toMatchObject({
      user_decision: "denied",
      effective: "denied",
    });
  });

  it("clears a stored row the policy default makes redundant or no longer honors", () => {
    const plan = planDecisionChanges(
      [
        {
          // A grant the gate ignores: effective already reads as the policy
          // default, the row is still there to come back live.
          tool: tool({
            name: "get_issue",
            policy: "ask",
            user_decision: "always_allow",
            effective: "ask",
          }),
          next: "ask",
        },
        {
          // A grant restating what the policy does anyway.
          tool: tool({
            name: "list_teams",
            policy: "auto",
            user_decision: "always_allow",
            effective: "allow",
          }),
          next: "allow",
        },
        // Nothing stored, nothing to clear.
        { tool: unprompted, next: "allow" },
      ],
      { allowAlways: false, askAvailable: true },
    );

    expect(plan.entries).toEqual([
      { tool_name: "get_issue", decision: null },
      { tool_name: "list_teams", decision: null },
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.projected.get("get_issue")).toMatchObject({
      user_decision: "none",
      effective: "ask",
    });
    expect(plan.projected.get("list_teams")).toMatchObject({
      user_decision: "none",
      effective: "allow",
    });
  });

  it("sends nothing for a tool whose stored row already is the target", () => {
    const plan = planDecisionChanges(
      [
        {
          tool: tool({
            name: "get_issue",
            policy: "ask",
            user_decision: "always_allow",
            effective: "allow",
          }),
          next: "allow",
        },
      ],
      all,
    );

    expect(plan.entries).toEqual([]);
    expect(plan.projected.size).toBe(0);
  });

  it("leaves a tool out, and reports it, where the deployment cannot store the state", () => {
    const plan = planDecisionChanges(
      [
        { tool: asking, next: "allow" },
        { tool: unprompted, next: "never" },
      ],
      none,
    );

    expect(plan.entries).toEqual([
      { tool_name: "list_teams", decision: "denied" },
    ]);
    expect(plan.skipped.map((skipped) => skipped.name)).toEqual(["get_issue"]);
  });
});

describe("groupChoiceChanges", () => {
  it("moves every tool to the chosen state, or each to its own policy default", () => {
    const asking = tool({ name: "get_issue", policy: "ask" });
    const unprompted = tool({ name: "list_teams", policy: "auto" });

    expect(groupChoiceChanges([asking, unprompted], "never")).toEqual([
      { tool: asking, next: "never" },
      { tool: unprompted, next: "never" },
    ]);
    expect(groupChoiceChanges([asking, unprompted], "default")).toEqual([
      { tool: asking, next: "ask" },
      { tool: unprompted, next: "allow" },
    ]);
  });
});

describe("groupCommonDecision", () => {
  it("names the state every tool shares and mixed otherwise", () => {
    expect(
      groupCommonDecision([
        tool({ effective: "denied" }),
        tool({ effective: "denied" }),
      ]),
    ).toBe("never");
    expect(
      groupCommonDecision([
        tool({ effective: "allow" }),
        tool({ effective: "ask" }),
      ]),
    ).toBe("mixed");
    expect(groupCommonDecision([])).toBe("mixed");
  });
});
