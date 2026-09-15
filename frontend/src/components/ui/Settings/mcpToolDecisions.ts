import type {
  McpServerTool,
  McpServerToolPolicy,
  McpToolEffectiveState,
  UserToolApprovalDecisionEntry,
  UserToolDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** The three states a tool row offers; each is one effective state. */
export type McpToolDecision = "allow" | "ask" | "never";

/** Every decision, in the order the control shows them. */
export const MCP_TOOL_DECISIONS: readonly McpToolDecision[] = [
  "allow",
  "ask",
  "never",
];

export const decisionOfEffective = (
  effective: McpToolEffectiveState,
): McpToolDecision => (effective === "denied" ? "never" : effective);

const effectiveOfDecision = (
  decision: McpToolDecision,
): McpToolEffectiveState => (decision === "never" ? "denied" : decision);

/** The state the policy puts a tool in when the user has decided nothing. */
export const policyDefault = (policy: McpServerToolPolicy): McpToolDecision =>
  policy === "ask" ? "ask" : "allow";

/** Which options the deployment lets the user store for one tool. */
export interface McpToolDecisionAvailability {
  allowAlways: boolean;
  askAvailable: boolean;
}

/**
 * The options a row can select. The policy default is always there, as is
 * "Never allow" (strictly more restrictive, honored regardless of policy).
 * The remaining option is a stored decision the gate only honors while the
 * deployment allows it, so it cannot be selected otherwise.
 */
export const offeredDecisions = (
  policy: McpServerToolPolicy,
  availability: McpToolDecisionAvailability,
): McpToolDecision[] => {
  const offered: McpToolDecision[] = [];
  if (policy === "auto" || availability.allowAlways) {
    offered.push("allow");
  }
  if (policy === "ask" || availability.askAvailable) {
    offered.push("ask");
  }
  offered.push("never");
  return offered;
};

/**
 * The row the batch endpoint stores for `next` on this tool: `null` clears
 * the row because `next` is what the policy does anyway, a decision is
 * written otherwise, and `undefined` means the deployment does not honor
 * that decision — the endpoint rejects the whole batch over one such entry,
 * so the caller leaves the tool out.
 */
export const storedDecisionFor = (
  tool: Pick<McpServerTool, "policy">,
  next: McpToolDecision,
  availability: McpToolDecisionAvailability,
): UserToolDecision | null | undefined => {
  if (next === policyDefault(tool.policy)) {
    return null;
  }
  if (next === "never") {
    return "denied";
  }
  if (next === "allow") {
    // eslint-disable-next-line lingui/no-unlocalized-strings -- API decision value
    return availability.allowAlways ? "always_allow" : undefined;
  }
  return availability.askAvailable ? "ask" : undefined;
};

/** One tool moved to one state. */
export interface McpToolDecisionChange {
  tool: McpServerTool;
  next: McpToolDecision;
}

export interface McpToolDecisionPlan {
  /** The batch entries, one per tool that actually changes. */
  entries: UserToolApprovalDecisionEntry[];
  /** The roster as it will read once the backend has applied the entries. */
  projected: Map<string, McpServerTool>;
  /** Tools whose target state the deployment does not honor. */
  skipped: McpServerTool[];
}

/**
 * Turns a set of changes into one batch. Tools already in the target state
 * cost nothing; tools whose target the deployment cannot store are reported
 * rather than sent, because the endpoint refuses a batch with one bad entry.
 */
export const planDecisionChanges = (
  changes: McpToolDecisionChange[],
  availability: McpToolDecisionAvailability,
): McpToolDecisionPlan => {
  const plan: McpToolDecisionPlan = {
    entries: [],
    projected: new Map(),
    skipped: [],
  };
  for (const { tool, next } of changes) {
    if (decisionOfEffective(tool.effective) === next) {
      continue;
    }
    const stored = storedDecisionFor(tool, next, availability);
    if (stored === undefined) {
      plan.skipped.push(tool);
      continue;
    }
    plan.entries.push({ tool_name: tool.name, decision: stored });
    plan.projected.set(tool.name, {
      ...tool,
      user_decision: stored ?? "none",
      effective: effectiveOfDecision(next),
    });
  }
  return plan;
};

/** What a group's dropdown can apply: one state, or back to the policy. */
export type McpToolGroupChoice = McpToolDecision | "default";

export const groupChoiceChanges = (
  tools: McpServerTool[],
  choice: McpToolGroupChoice,
): McpToolDecisionChange[] =>
  tools.map((tool) => ({
    tool,
    next: choice === "default" ? policyDefault(tool.policy) : choice,
  }));

/** The state every tool in the group is in, or "mixed". */
export const groupCommonDecision = (
  tools: McpServerTool[],
): McpToolDecision | "mixed" => {
  if (tools.length === 0) {
    return "mixed";
  }
  const decision = decisionOfEffective(tools[0].effective);
  return tools.every((tool) => decisionOfEffective(tool.effective) === decision)
    ? decision
    : "mixed";
};
