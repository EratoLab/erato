import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const executors = new Set<{
  name: string;
  binding: () => ExecutorBinding | undefined;
  yields: boolean;
}>();

/** Durable executors advertise capability without registering an SSE executor.
 * A yielding executor never displaces another one's routing context: it joins
 * the submit header only when its binding is equal. */
export function registerOperationExecutor(
  name: string,
  binding: () => ExecutorBinding | undefined,
  options: { yields?: boolean } = {},
): () => void {
  const entry = { name, binding, yields: options.yields ?? false };
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

export function operationExecutorHeaders(): Partial<
  Record<"X-Erato-Executor" | "X-Erato-Client-Tools", string>
> {
  const ready = [...executors].flatMap((entry) => {
    const binding = entry.binding();
    return binding ? [{ ...entry, serialized: JSON.stringify(binding) }] : [];
  });
  const strict = ready.filter((entry) => !entry.yields);
  const leaders = strict.length ? strict : ready;
  const first = leaders.at(0);
  if (!first) return {};
  // A submit has one routing context. Conflicting hosts must not pick one by
  // registration order; a future multi-executor envelope needs explicit support.
  if (leaders.some((entry) => entry.serialized !== first.serialized)) return {};
  return {
    "X-Erato-Executor": first.serialized,
    "X-Erato-Client-Tools": [
      ...new Set(
        ready
          .filter((entry) => entry.serialized === first.serialized)
          .map((entry) => entry.name),
      ),
    ]
      .sort()
      .join(","),
  };
}
