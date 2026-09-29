import { MAX_PLAN_BYTES } from "./wordDocumentPlan";

import type { WordPlanDiagnostics } from "./wordPlanDiagnostics";
import type { ClientToolExecutionResult } from "@erato/frontend/library";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

/** Stable comparison preserves array order and ignores object property order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    object(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export class WordDraftRepairError extends Error {
  constructor(
    readonly path: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function invalidPatch(index: number): never {
  throw new WordDraftRepairError(
    `/patches/${index}`,
    "repair-patch",
    "Use add, replace or remove with an existing JSON Pointer parent. Array indexes must be in range; only add accepts '-'. Snapshot, readToken and version are immutable.",
  );
}

/** Atomic RFC 6902 add/replace/remove subset; no prototype or identity writes. */
export function applyWordDraftPatches(
  plan: Record<string, unknown>,
  patches: unknown,
): Record<string, unknown> {
  if (!Array.isArray(patches) || patches.length < 1 || patches.length > 32)
    throw new WordDraftRepairError(
      "/patches",
      "repair-patch",
      "A repair requires 1–32 patches.",
    );
  const result = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
  for (const [index, patch] of patches.entries()) {
    if (
      !object(patch) ||
      !["add", "replace", "remove"].includes(String(patch.op)) ||
      typeof patch.path !== "string" ||
      !patch.path.startsWith("/") ||
      patch.path.length > 512 ||
      Object.keys(patch).some(
        (key) => !["op", "path", "value"].includes(key),
      ) ||
      (patch.op === "remove" ? own(patch, "value") : !own(patch, "value"))
    )
      invalidPatch(index);
    const encoded = patch.path.split("/").slice(1);
    if (encoded.length > 32 || encoded.some((key) => /~(?![01])/u.test(key)))
      invalidPatch(index);
    const keys = encoded.map((key) =>
      key.replaceAll("~1", "/").replaceAll("~0", "~"),
    );
    if (
      !["scope", "entries", "deleted", "stories", "sections"].includes(
        keys[0],
      ) ||
      keys.some((key) =>
        ["__proto__", "prototype", "constructor"].includes(key),
      )
    )
      invalidPatch(index);
    let parent: unknown = result;
    for (const key of keys.slice(0, -1)) {
      if (
        (!object(parent) && !Array.isArray(parent)) ||
        !own(parent, key) ||
        (Array.isArray(parent) && !/^(0|[1-9]\d*)$/u.test(key))
      )
        invalidPatch(index);
      parent = (parent as Record<string, unknown>)[key];
    }
    const key = keys[keys.length - 1];
    if (Array.isArray(parent)) {
      const at =
        key === "-" && patch.op === "add"
          ? parent.length
          : /^(0|[1-9]\d*)$/u.test(key)
            ? Number(key)
            : -1;
      if (
        !Number.isSafeInteger(at) ||
        at < 0 ||
        at > parent.length ||
        (patch.op !== "add" && at === parent.length)
      )
        invalidPatch(index);
      if (patch.op === "add") parent.splice(at, 0, patch.value);
      else if (patch.op === "remove") parent.splice(at, 1);
      else parent[at] = patch.value;
    } else {
      if (!object(parent) || (patch.op !== "add" && !own(parent, key)))
        invalidPatch(index);
      if (patch.op === "remove") delete parent[key];
      else parent[key] = patch.value;
    }
    if (
      new TextEncoder().encode(JSON.stringify(result)).length > MAX_PLAN_BYTES
    )
      throw new WordDraftRepairError(
        "/patches",
        "too-large",
        "The repaired plan exceeds maxPlanBytes.",
      );
  }
  return result;
}

/** In-memory correction state has exactly the lifetime of its captured read session. */
export class WordDocumentDraftStore {
  private draft?: {
    id: string;
    revision: number;
    value: Record<string, unknown>;
  };
  private failure?: string;
  private replies = new Map<
    string,
    { input: string; result: ClientToolExecutionResult }
  >();
  accepted = false;

  clear(): void {
    this.draft = undefined;
    this.failure = undefined;
    this.replies.clear();
    this.accepted = false;
  }

  replay(callId: string, input: string): ClientToolExecutionResult | undefined {
    const previous = this.replies.get(callId);
    if (previous && previous.input !== input)
      throw new WordDraftRepairError(
        "",
        "call-conflict",
        "A tool call ID cannot be reused with different arguments.",
      );
    return previous?.result;
  }

  remember(
    callId: string,
    input: string,
    result: ClientToolExecutionResult,
  ): ClientToolExecutionResult {
    this.replies.set(callId, { input, result });
    if (this.replies.size > 16)
      this.replies.delete(this.replies.keys().next().value!);
    return result;
  }

  materialize(input: Record<string, unknown>): Record<string, unknown> {
    if (!own(input, "draft_id")) return input;
    if (
      Object.keys(input).some(
        (key) =>
          ![
            "snapshot",
            "readToken",
            "draft_id",
            "revision",
            "patches",
          ].includes(key),
      )
    )
      throw new WordDraftRepairError(
        "",
        "repair-shape",
        "A repair contains snapshot, readToken, draft_id, revision and patches only.",
      );
    if (
      !this.draft ||
      input.draft_id !== this.draft.id ||
      input.revision !== this.draft.revision
    )
      throw new WordDraftRepairError(
        "/revision",
        "draft-revision",
        "The draft ID or revision is unavailable or stale. Use the latest rejected draft receipt or submit a complete plan.",
      );
    return applyWordDraftPatches(this.draft.value, input.patches);
  }

  feedback() {
    return this.draft
      ? {
          draft: { id: this.draft.id, revision: this.draft.revision },
          terminal: false,
        }
      : undefined;
  }

  reject(value: Record<string, unknown>, issues: WordPlanDiagnostics) {
    const fingerprint = canonical([value, issues]);
    const terminal = fingerprint === this.failure;
    const unchanged =
      this.draft && canonical(value) === canonical(this.draft.value);
    this.draft = {
      id: this.draft?.id ?? globalThis.crypto.randomUUID(),
      revision: this.draft ? this.draft.revision + (unchanged ? 0 : 1) : 1,
      value,
    };
    this.failure = fingerprint;
    return {
      draft: { id: this.draft.id, revision: this.draft.revision },
      terminal,
    };
  }
}
