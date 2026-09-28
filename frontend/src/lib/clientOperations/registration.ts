import type { ExecutorBinding } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const executors = new Set<{
  name: string;
  binding: () => ExecutorBinding | undefined;
}>();

/** Durable executors advertise capability without registering an SSE executor. */
export function registerOperationExecutor(
  name: string,
  binding: () => ExecutorBinding | undefined,
): () => void {
  const entry = { name, binding };
  executors.add(entry);
  return () => {
    executors.delete(entry);
  };
}

export function operationExecutorHeaders(): Partial<
  Record<"X-Erato-Executor" | "X-Erato-Client-Tools", string>
> {
  const ready = [...executors].flatMap((entry) => {
    const binding = entry.binding();
    return binding ? [{ name: entry.name, binding }] : [];
  });
  const first = ready.at(0);
  if (!first) return {};
  const serialized = JSON.stringify(first.binding);
  // A submit has one routing context. Conflicting hosts must not pick one by
  // registration order; a future multi-executor envelope needs explicit support.
  if (ready.some((entry) => JSON.stringify(entry.binding) !== serialized))
    return {};
  return {
    "X-Erato-Executor": serialized,
    "X-Erato-Client-Tools": [...new Set(ready.map((entry) => entry.name))]
      .sort()
      .join(","),
  };
}
