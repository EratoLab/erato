import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const executors = new Set<{
  name: string;
  binding: () => ExecutorBinding | undefined;
  yields: boolean;
  additional: boolean;
}>();

/** As many as the server keeps; further bindings never reach a task. */
const MAX_ADDITIONAL_EXECUTORS = 4;

/** Durable executors advertise capability without registering an SSE executor.
 * A yielding executor never displaces another one's routing context: it joins
 * the submit header only when its binding is equal. An additional executor
 * never takes part in choosing `X-Erato-Executor`: its binding travels in
 * `X-Erato-Additional-Executors`, which a server without it ignores, so the
 * primary header stays what an older server routes by. */
export function registerOperationExecutor(
  name: string,
  binding: () => ExecutorBinding | undefined,
  options: { yields?: boolean; additional?: boolean } = {},
): () => void {
  const entry = {
    name,
    binding,
    yields: options.yields ?? false,
    additional: options.additional ?? false,
  };
  executors.add(entry);
  return () => {
    executors.delete(entry);
  };
}

export function operationExecutorBinding(
  name: string,
): ExecutorBinding | undefined {
  for (const entry of executors) {
    if (entry.name !== name) continue;
    const binding = entry.binding();
    if (binding) return binding;
  }
  return undefined;
}

function readyEntries() {
  return [...executors].flatMap((entry) => {
    const binding = entry.binding();
    return binding
      ? [{ ...entry, binding, serialized: JSON.stringify(binding) }]
      : [];
  });
}

type ReadyEntry = ReturnType<typeof readyEntries>[number];

function primaryEntry(ready: readonly ReadyEntry[]): ReadyEntry | undefined {
  const candidates = ready.filter((entry) => !entry.additional);
  const strict = candidates.filter((entry) => !entry.yields);
  const leaders = strict.length ? strict : candidates;
  const first = leaders.at(0);
  // A submit has one routing context. Conflicting hosts must not pick one by
  // registration order.
  if (!first || leaders.some((entry) => entry.serialized !== first.serialized))
    return undefined;
  return first;
}

/** Ready additional bindings and the tool names registered with each. */
export function additionalOperationBindings(): {
  binding: ExecutorBinding;
  names: string[];
}[] {
  const bindings = new Map<
    string,
    { binding: ExecutorBinding; names: string[] }
  >();
  for (const entry of readyEntries()) {
    if (!entry.additional) continue;
    const known = bindings.get(entry.serialized);
    if (known) known.names.push(entry.name);
    else
      bindings.set(entry.serialized, {
        binding: entry.binding,
        names: [entry.name],
      });
  }
  return [...bindings.values()].map(({ binding, names }) => ({
    binding,
    names: [...new Set(names)].sort(),
  }));
}

export function operationExecutorHeaders(): Partial<
  Record<
    | "X-Erato-Executor"
    | "X-Erato-Additional-Executors"
    | "X-Erato-Client-Tools",
    string
  >
> {
  const ready = readyEntries();
  const primary = primaryEntry(ready);
  const kinds = new Set<string>();
  const primaryKind = primary?.binding.host_context?.kind;
  if (primaryKind) kinds.add(primaryKind);
  // One per host kind, as the server keeps them; a kind the primary already
  // has would be dropped there.
  const additional = additionalOperationBindings()
    .map(({ binding }) => binding)
    .filter((binding) => {
      const kind = binding.host_context?.kind;
      if (!kind || kinds.has(kind)) return false;
      kinds.add(kind);
      return true;
    })
    .slice(0, MAX_ADDITIONAL_EXECUTORS);
  return {
    ...(primary
      ? {
          "X-Erato-Executor": primary.serialized,
          "X-Erato-Client-Tools": [
            ...new Set(
              ready
                .filter(
                  (entry) =>
                    !entry.additional &&
                    entry.serialized === primary.serialized,
                )
                .map((entry) => entry.name),
            ),
          ]
            .sort()
            .join(","),
        }
      : {}),
    ...(additional.length
      ? { "X-Erato-Additional-Executors": JSON.stringify(additional) }
      : {}),
  };
}
